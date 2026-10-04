import type { Folder } from "./resource-client";

// 資料夾在伺服器上是扁平的「路徑名」（例如 card/art/blur）：目錄上傳會自動以目錄為名建夾，
// 作者手動建的夾也可以含斜線。頁面把這些名字拆成樹，缺的中間層補成「虛擬節點」
// （沒有 folderId，只用來往下走），所以 card/art/blur 存在而 card 不存在時，card 還是看得到。
export interface FolderNode {
  // 這一層的名字（art）
  name: string;
  // 完整路徑（card/art）
  path: string;
  // 伺服器上真的有這個夾才有
  folderId?: string;
  // 直接放在這個夾裡的檔案數
  own: number;
  // 含所有子夾
  count: number;
  children: FolderNode[];
}

export function buildFolderTree(folders: Folder[]): FolderNode {
  const root: FolderNode = { name: "", path: "", own: 0, count: 0, children: [] };
  const byPath = new Map<string, FolderNode>([["", root]]);
  for (const f of [...folders].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = f.name.split("/").filter(Boolean);
    if (!parts.length) continue;
    let parent = root,
      path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = byPath.get(path);
      if (!node) {
        node = { name: part, path, own: 0, count: 0, children: [] };
        byPath.set(path, node);
        parent.children.push(node);
      }
      parent = node;
    }
    // 同名夾只認第一個（伺服器也是）：第二個同名列不再開一個節點。
    if (parent.folderId === undefined) parent.folderId = f.folderId;
    parent.own += f.imageCount;
  }
  const total = (n: FolderNode): number =>
    (n.count = n.own + n.children.reduce((sum, c) => sum + total(c), 0));
  total(root);
  return root;
}

export function findNode(root: FolderNode, path: string): FolderNode | undefined {
  if (!path) return root;
  let node: FolderNode | undefined = root;
  for (const part of path.split("/")) {
    node = node?.children.find((c) => c.name === part);
    if (!node) return undefined;
  }
  return node;
}

export function findByFolderId(root: FolderNode, folderId: string): FolderNode | undefined {
  for (const c of root.children) {
    if (c.folderId === folderId) return c;
    const hit = findByFolderId(c, folderId);
    if (hit) return hit;
  }
  return undefined;
}

/** 深度優先攤平，給側欄與手機下拉用。 */
export function flattenTree(root: FolderNode): { node: FolderNode; depth: number }[] {
  const rows: { node: FolderNode; depth: number }[] = [];
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const n of nodes) {
      rows.push({ node: n, depth });
      walk(n.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return rows;
}

/** 在某個夾裡看檔案時，檔名去掉夾的路徑前綴；不在那個前綴下的（手動移進來的）照原樣顯示。 */
export function relativeName(fileName: string, folderPath: string): string {
  if (folderPath && fileName.startsWith(folderPath + "/")) return fileName.slice(folderPath.length + 1);
  return fileName;
}
