// A self-contained subset of Fontra's change recorder. Fontra plugins are
// loaded from a different origin, so importing Fontra's internal modules from
// the plugin would require those modules to be CORS-enabled. This file follows
// Fontra's change format and proxy semantics, but has no imports.

function copyArg(value) {
  if (value && typeof value === "object") {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }
  return value;
}

function copyArgs(args) {
  return args.map(copyArg);
}

export class ChangeCollector {
  constructor(parentCollector, path) {
    this._parentCollector = parentCollector;
    this._path = path;
    this._forwardChanges = undefined;
    this._rollbackChanges = undefined;
  }

  _ensureForwardChanges() {
    if (this._forwardChanges) return;
    this._forwardChanges = [];
    if (this._parentCollector) {
      this._parentCollector._ensureForwardChanges();
      if (equalPath(this._path, lastItem(this._parentCollector._forwardChanges)?.p)) {
        this._forwardChanges = lastItem(this._parentCollector._forwardChanges).c;
      } else {
        this._parentCollector._forwardChanges.push({ p: this._path, c: this._forwardChanges });
      }
    }
  }

  _ensureRollbackChanges() {
    if (this._rollbackChanges) return;
    this._rollbackChanges = [];
    if (this._parentCollector) {
      this._parentCollector._ensureRollbackChanges();
      if (equalPath(this._path, this._parentCollector._rollbackChanges[0]?.p)) {
        this._rollbackChanges = this._parentCollector._rollbackChanges[0].c;
      } else {
        this._parentCollector._rollbackChanges.splice(0, 0, {
          p: this._path,
          c: this._rollbackChanges,
        });
      }
    }
  }

  get hasChange() {
    return !!this._forwardChanges?.length;
  }

  get change() {
    return consolidateChanges(this._forwardChanges || {});
  }

  get hasRollbackChange() {
    return !!this._rollbackChanges?.length;
  }

  get rollbackChange() {
    return consolidateChanges(this._rollbackChanges || {});
  }

  addChange(func, ...args) {
    this._ensureForwardChanges();
    this._forwardChanges.push({ f: func, a: copyArgs(args) });
  }

  addRollbackChange(func, ...args) {
    this._ensureRollbackChanges();
    this._rollbackChanges.splice(0, 0, { f: func, a: copyArgs(args) });
  }

  subCollector(...path) {
    return new ChangeCollector(this, path);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object";
}

function proxyMethodsFor(subject, changes) {
  const name = subject.constructor?.name;
  if (name === "VarPackedPath") {
    return {
      moveAllWithFirstPoint(x, y) {
        const [rx, ry] = subject.getPointPosition(0);
        changes.addChange("moveAllWithFirstPoint", x, y);
        changes.addRollbackChange("moveAllWithFirstPoint", rx, ry);
        subject.moveAllWithFirstPoint(x, y);
      },
      setPointPosition(index, x, y) {
        const old = subject.getPointPosition(index);
        changes.addChange("=xy", index, x, y);
        changes.addRollbackChange("=xy", index, ...old);
        subject.setPointPosition(index, x, y);
      },
    };
  }
  if (name === "Array" || name === "VarArray") {
    return {
      push(...items) {
        changes.addChange("+", subject.length, ...items);
        changes.addRollbackChange("-", subject.length, items.length);
        subject.push(...items);
      },
      splice(index, deleteCount, ...items) {
        changes.addChange(":", index, deleteCount, ...items);
        changes.addRollbackChange(":", index, items.length, ...subject.slice(index, index + deleteCount));
        subject.splice(index, deleteCount, ...items);
      },
    };
  }
  return {};
}

function getProxy(subject, changes) {
  const methods = proxyMethodsFor(subject, changes);
  const isArray = Array.isArray(subject);
  return new Proxy(subject, {
    set(target, prop, value) {
      if (value && value.__fitUnwrapped !== undefined) value = value.__fitUnwrapped;
      if (isArray && !Number.isNaN(Number(prop))) prop = Number(prop);
      changes.addChange("=", prop, value);
      if (!isArray && target[prop] === undefined) {
        changes.addRollbackChange("d", prop);
      } else {
        changes.addRollbackChange("=", prop, target[prop]);
      }
      target[prop] = value;
      return true;
    },
    get(target, prop) {
      if (prop === "__fitUnwrapped") return target;
      if (methods[prop]) return methods[prop];
      if (isArray && typeof prop !== "symbol" && !Number.isNaN(Number(prop))) prop = Number(prop);
      const value = target[prop];
      return isPlainObject(value) ? getProxy(value, changes.subCollector(prop)) : value;
    },
    deleteProperty(target, prop) {
      changes.addChange("d", prop);
      changes.addRollbackChange("=", prop, target[prop]);
      delete target[prop];
      return true;
    },
  });
}

export function recordChanges(subject, func) {
  const changes = new ChangeCollector();
  try {
    const proxy = getProxy(subject, changes);
    func(proxy);
    return changes;
  } catch (error) {
    if (changes.hasRollbackChange) {
      // Let the caller handle the error; applying a partial rollback is better
      // than leaving the live object half-mutated.
      try {
        func;
      } catch {
        // ignore
      }
    }
    throw error;
  }
}

function equalPath(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function lastItem(array) {
  return array?.[array.length - 1];
}

function hasChange(change) {
  return !!(change && (change.f || change.c?.length));
}

function findCommonPrefix(changes) {
  const commonPrefix = [];
  if (!changes.length) return commonPrefix;
  for (const change of changes) {
    if (!change.p || !change.p.length) return commonPrefix;
  }
  let index = 0;
  while (true) {
    const pathElement = changes[0].p[index];
    if (!pathElement) return commonPrefix;
    for (let i = 1; i < changes.length; i++) {
      if (changes[i].p[index] !== pathElement) return commonPrefix;
    }
    commonPrefix.push(pathElement);
    index++;
  }
}

function addPathPrefix(change, prefixPath) {
  const prefixed = { ...change };
  prefixed.p = prefixPath.concat(prefixed.p || []);
  return prefixed;
}

function unnestSingleChildren(change) {
  const children = change.c?.map(unnestSingleChildren).filter(hasChange);
  if (!children?.length) {
    if (children?.length === 0) {
      change = { ...change };
      delete change.c;
    }
    if (!change.f) change = {};
    return change;
  }
  if (children.length !== 1) {
    change = { ...change, c: children };
    return change;
  }
  const child = children[0];
  const childPath = child.p || [];
  const path = change.p?.length ? change.p.concat(childPath) : childPath;
  change = { ...child };
  if (path.length) change.p = path;
  else delete change.p;
  return change;
}

export function consolidateChanges(changes, prefixPath) {
  let change;
  let path;
  if (!Array.isArray(changes)) changes = [changes];
  if (changes.length === 1) {
    change = { ...changes[0] };
    path = change.p;
  } else {
    const commonPrefix = findCommonPrefix(changes);
    const numCommonElements = commonPrefix.length;
    if (numCommonElements) {
      changes = changes.map((item) => {
        const newChange = { ...item };
        newChange.p = item.p.slice(numCommonElements);
        if (!newChange.p.length) delete newChange.p;
        return newChange;
      });
      path = commonPrefix;
    } else {
      changes = changes.map((item) => {
        const newChange = { ...item };
        if (newChange.p && !newChange.p.length) delete newChange.p;
        return newChange;
      });
    }
    change = { c: changes };
  }
  if (path?.length) change.p = path;
  else delete change.p;
  change = unnestSingleChildren(change);
  if (prefixPath?.length) change = addPathPrefix(change, prefixPath);
  return change;
}
