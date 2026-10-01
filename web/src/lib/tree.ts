// Rebuilds the multi-level result tree (Build > Testsuite > category >
// subcategory > suite > test) from the flat leaves stored with their category_path.
import type { TestResult } from './types';

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  leaf?: TestResult;
  passed: number;
  total: number;
}

const ROOT_ORDER = ['Build', 'Testsuite'];

export function leafPassed(leaf: TestResult) {
  return leaf.status === 'pass' && leaf.valgrind_ok !== 0;
}

export function buildTree(results: TestResult[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [], passed: 0, total: 0 };
  const index = new Map<string, TreeNode>();

  for (const result of results) {
    let parent = root;
    let path = '';
    for (const part of result.category_path.split('/').filter(Boolean)) {
      path = path ? `${path}/${part}` : part;
      let node = index.get(path);
      if (!node) {
        node = { name: part, path, children: [], passed: 0, total: 0 };
        index.set(path, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.children.push({
      name: result.test_name,
      path: `${path}/#${result.id}`,
      children: [],
      leaf: result,
      passed: leafPassed(result) ? 1 : 0,
      total: 1,
    });
  }

  const sum = (node: TreeNode): void => {
    if (node.leaf) return;
    node.children.forEach(sum);
    node.passed = node.children.reduce((n, c) => n + c.passed, 0);
    node.total = node.children.reduce((n, c) => n + c.total, 0);
  };
  root.children.forEach(sum);
  root.children.sort((a, b) => rank(a.name) - rank(b.name));
  return root.children;
}

function rank(name: string) {
  const i = ROOT_ORDER.indexOf(name);
  return i === -1 ? ROOT_ORDER.length : i;
}

export function collectFailingPaths(nodes: TreeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode) => {
    if (n.passed < n.total) out.add(n.path);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
