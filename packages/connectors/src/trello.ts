import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  list_id: string;
  list_name: string;
  board_id: string;
  labels: string[];
  due: string | null;
  members: string[];
  url: string;
}

export interface TrelloConnector extends Connector {
  listCards(boardId: string, opts?: { listId?: string; label?: string }): Promise<TrelloCard[]>;
  getCard(cardId: string): Promise<TrelloCard>;
  commentCard(cardId: string, text: string): Promise<void>;
  moveCard(cardId: string, toListId: string): Promise<void>;
  createCard(opts: { listId: string; name: string; desc?: string; labels?: string[] }): Promise<TrelloCard>;
  listBoards(): Promise<Array<{ id: string; name: string }>>;
}

class TrelloClient implements TrelloConnector {
  readonly kind: IntegrationKind = "trello";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { api_key: string; token: string },
  ) {}

  private qs(extra: Record<string, string> = {}): string {
    return new URLSearchParams({
      key: this.creds.api_key,
      token: this.creds.token,
      ...extra,
    }).toString();
  }

  private async fetch(path: string, init: RequestInit = {}, extraQs: Record<string, string> = {}) {
    const sep = path.includes("?") ? "&" : "?";
    const resp = await fetch(`https://api.trello.com/1${path}${sep}${this.qs(extraQs)}`, init);
    if (!resp.ok) throw new Error(`Trello ${resp.status}: ${await resp.text()}`);
    return resp;
  }

  async healthcheck() {
    try {
      await this.fetch("/members/me");
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listBoards() {
    const resp = await this.fetch("/members/me/boards", {}, { fields: "name" });
    return (await resp.json()) as Array<{ id: string; name: string }>;
  }

  async listCards(boardId: string, opts?: { listId?: string; label?: string }) {
    const resp = await this.fetch(
      `/boards/${boardId}/cards`,
      {},
      { fields: "name,desc,idList,labels,due,idMembers,url" },
    );
    const rows = (await resp.json()) as TrelloCardRow[];
    const lists = await this.getListsMap(boardId);
    return rows
      .filter((r) => (opts?.listId ? r.idList === opts.listId : true))
      .filter((r) =>
        opts?.label ? r.labels.some((l) => l.name === opts.label) : true,
      )
      .map((r) => mapCard(r, boardId, lists.get(r.idList) ?? ""));
  }

  async getCard(cardId: string) {
    const resp = await this.fetch(`/cards/${cardId}`, {}, { fields: "name,desc,idList,idBoard,labels,due,idMembers,url" });
    const row = (await resp.json()) as TrelloCardRow;
    const lists = await this.getListsMap(row.idBoard ?? "");
    return mapCard(row, row.idBoard ?? "", lists.get(row.idList) ?? "");
  }

  async commentCard(cardId: string, text: string) {
    await this.fetch(`/cards/${cardId}/actions/comments`, { method: "POST" }, { text });
  }

  async moveCard(cardId: string, toListId: string) {
    await this.fetch(`/cards/${cardId}`, { method: "PUT" }, { idList: toListId });
  }

  async createCard(opts: { listId: string; name: string; desc?: string; labels?: string[] }) {
    const resp = await this.fetch(
      `/cards`,
      { method: "POST" },
      {
        idList: opts.listId,
        name: opts.name,
        desc: opts.desc ?? "",
      },
    );
    const row = (await resp.json()) as TrelloCardRow;
    const lists = await this.getListsMap(row.idBoard ?? "");
    return mapCard(row, row.idBoard ?? "", lists.get(row.idList) ?? "");
  }

  private listsCache = new Map<string, Map<string, string>>();
  private async getListsMap(boardId: string): Promise<Map<string, string>> {
    if (!boardId) return new Map();
    if (this.listsCache.has(boardId)) return this.listsCache.get(boardId)!;
    const resp = await this.fetch(`/boards/${boardId}/lists`, {}, { fields: "name" });
    const rows = (await resp.json()) as Array<{ id: string; name: string }>;
    const m = new Map(rows.map((r) => [r.id, r.name]));
    this.listsCache.set(boardId, m);
    return m;
  }
}

interface TrelloCardRow {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idBoard?: string;
  labels: Array<{ id: string; name: string; color: string }>;
  due: string | null;
  idMembers: string[];
  url: string;
}

function mapCard(r: TrelloCardRow, boardId: string, listName: string): TrelloCard {
  return {
    id: r.id,
    name: r.name,
    desc: r.desc,
    list_id: r.idList,
    list_name: listName,
    board_id: boardId,
    labels: r.labels.map((l) => l.name).filter(Boolean),
    due: r.due,
    members: r.idMembers,
    url: r.url,
  };
}

export const trelloFactory: ConnectorFactory<TrelloConnector> = {
  kind: "trello",
  async create({ tenant, credentials }) {
    return new TrelloClient(tenant, credentials as TrelloClient["creds"]);
  },
};
