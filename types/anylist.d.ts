declare module 'anylist' {
  interface AnyListItem {
    name: string;
    quantity?: string;
    details?: string;
    checked?: boolean;
    identifier: string;
    save(): Promise<void>;
  }

  interface AnyListList {
    name: string;
    items: AnyListItem[];
    addItem(item: AnyListItem): Promise<AnyListItem>;
    getItemByName(name: string): AnyListItem | undefined;
  }

  interface AnyListOptions {
    email: string;
    password: string;
    credentialsFile?: string | null;
  }

  export default class AnyList {
    constructor(options: AnyListOptions);
    login(): Promise<void>;
    getLists(): Promise<AnyListList[]>;
    getListByName(name: string): AnyListList | undefined;
    createItem(item: { name: string; quantity?: string; details?: string }): AnyListItem;
    teardown(): void;
  }
}
