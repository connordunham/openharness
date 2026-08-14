/** Union-Find (disjoint set) with path compression + union by rank. O(α(n)) per op. */
export class UnionFind<T> {
  private parent = new Map<T, T>();
  private rank = new Map<T, number>();

  add(x: T): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: T): T {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as T;
    }
    // Path compression.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as T;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: T, b: T): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  /** Every added element, grouped by its root representative. */
  groups(): Map<T, T[]> {
    const out = new Map<T, T[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      if (!out.has(root)) out.set(root, []);
      out.get(root)!.push(x);
    }
    return out;
  }
}
