'use client';

// Collapsible result tree: every level shows
// "X / Y" and a check / cross; fully passing branches start collapsed so the
// student can focus on failures. Selecting a test opens its detail panel.
import { useMemo, useState } from 'react';
import type { TestResult } from '@/lib/types';
import { buildTree, collectFailingPaths, type TreeNode } from '@/lib/tree';
import { IconAlert, IconCheck, IconChevronDown, IconChevronRight, IconCross, IconDash } from './Icons';
import type { ReportingContext } from './Reports';
import { TestDetail } from './TestDetail';
import styles from './ResultTree.module.css';

function firstFailingLeaf(nodes: TreeNode[]): TestResult | null {
  for (const node of nodes) {
    if (node.leaf && node.passed < node.total) return node.leaf;
    const found = firstFailingLeaf(node.children);
    if (found) return found;
  }
  return null;
}

/** `reporting` is only passed on student pages: enables reports and votes. */
export function ResultTree({ results, reporting }: { results: TestResult[]; reporting?: ReportingContext }) {
  const disputed = useMemo(
    () => new Set((reporting?.reports ?? []).filter((r) => r.status === 'open').map((r) => `${r.category_path}\u0000${r.test_name}`)),
    [reporting],
  );
  const tree = useMemo(() => buildTree(results), [results]);
  const [open, setOpen] = useState<Set<string>>(() => {
    const initial = collectFailingPaths(tree);
    tree.forEach((n) => initial.add(n.path)); // top levels always visible
    return initial;
  });
  const [selected, setSelected] = useState<TestResult | null>(() => firstFailingLeaf(tree));

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const expandFailing = () => {
    const next = collectFailingPaths(tree);
    tree.forEach((n) => next.add(n.path));
    setOpen(next);
  };
  const expandAll = () => {
    const next = new Set<string>();
    const walk = (n: TreeNode) => {
      if (!n.leaf) next.add(n.path);
      n.children.forEach(walk);
    };
    tree.forEach(walk);
    setOpen(next);
  };

  if (results.length === 0) {
    return <p className="muted">No test result for this submission.</p>;
  }

  return (
    <div className={styles.layout}>
      <div className={`card card-tight ${styles.treePanel}`}>
        <div className="spread" style={{ marginBottom: 'var(--s-3)' }}>
          <span className="caption">Results</span>
          <div className="row" style={{ gap: 'var(--s-1)' }}>
            <button type="button" className="btn btn-ghost" onClick={expandFailing}>Failures only</button>
            <button type="button" className="btn btn-ghost" onClick={expandAll}>Expand all</button>
          </div>
        </div>
        <ul className={styles.tree} role="tree">
          {tree.map((node) => (
            <Node key={node.path} node={node} depth={0} open={open} toggle={toggle} selected={selected} onSelect={setSelected} disputed={disputed} />
          ))}
        </ul>
      </div>
      <div className={styles.detailPanel}>
        {selected ? (
          <TestDetail key={selected.id} result={selected} reporting={reporting} />
        ) : (
          <div className="card muted">Select a test in the tree to see its details.</div>
        )}
      </div>
    </div>
  );
}

type NodeProps = {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
  selected: TestResult | null;
  onSelect: (r: TestResult) => void;
  disputed: Set<string>;
};

function StatusMark({ node }: { node: TreeNode }) {
  const leaf = node.leaf;
  if (leaf && (leaf.status === 'skipped' || leaf.status === 'error')) {
    return <IconDash className="s-warn" title="Not run" />;
  }
  return node.passed === node.total
    ? <IconCheck className="s-pass" title="Passed" />
    : <IconCross className="s-fail" title="Failed" />;
}

function Node({ node, depth, open, toggle, selected, onSelect, disputed }: NodeProps) {
  if (node.leaf) {
    const leaf = node.leaf;
    const isSelected = selected?.id === leaf.id;
    const isDisputed = disputed.has(`${leaf.category_path}\u0000${leaf.test_name}`);
    return (
      <li role="treeitem" aria-selected={isSelected}>
        <button
          type="button"
          className={`${styles.row} ${styles.leaf} ${isSelected ? styles.selected : ''}`}
          style={{ paddingLeft: 8 + depth * 18 }}
          onClick={() => onSelect(leaf)}
        >
          <span className={styles.guide} />
          <span className={styles.name}>{node.name}</span>
          <StatusMark node={node} />
          {isDisputed ? <IconAlert size={12} className="s-warn" title="Reported as possibly wrong" /> : null}
        </button>
      </li>
    );
  }
  const isOpen = open.has(node.path);
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        className={`${styles.row} ${depth === 0 ? styles.top : ''}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => toggle(node.path)}
      >
        {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span className={styles.name}>{node.name}</span>
        <StatusMark node={node} />
        <span className={styles.count}>
          {node.passed} / {node.total}
        </span>
      </button>
      {isOpen ? (
        <ul role="group" className={styles.tree}>
          {node.children.map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} disputed={disputed} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
