import { createRequire as __seamkitCreateRequire } from 'node:module';
const require = __seamkitCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count3, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count3);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count3 = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count3)
            count3 = c;
        }
        return count3;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str3) => str3.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str3, indent, comment) => str3.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str3.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str3) => /^(%|---|\.\.\.)/m.test(str3);
    function lineLengthOverLimit(str3, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str3.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str3[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str3 = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str3 += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str3 += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str3 += "\\0";
                    break;
                  case "0007":
                    str3 += "\\a";
                    break;
                  case "000b":
                    str3 += "\\v";
                    break;
                  case "001b":
                    str3 += "\\e";
                    break;
                  case "0085":
                    str3 += "\\N";
                    break;
                  case "00a0":
                    str3 += "\\_";
                    break;
                  case "2028":
                    str3 += "\\L";
                    break;
                  case "2029":
                    str3 += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str3 += "\\x" + code.substr(2);
                    else
                      str3 += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str3 += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str3 += "\n";
                  i += 2;
                }
                str3 += indent;
                if (json[i + 2] === " ")
                  str3 += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str3 = start ? str3 + json.slice(start) : json;
      return implicitKey ? str3 : foldFlowLines.foldFlowLines(str3, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str3 = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str3);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str3 : foldFlowLines.foldFlowLines(str3, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str3 = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str3;
      return identity.isScalar(node) || str3[0] === "{" || str3[0] === "[" ? `${props} ${str3}` : `${props}
${ctx.indent}${str3}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str3 = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str3.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str3 === "" ? "?" : explicitKey ? `? ${str3}` : str3;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str3 = `? ${str3}`;
        if (keyComment && !keyCommentDone) {
          str3 += stringifyComment.lineComment(str3, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str3;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str3 += stringifyComment.lineComment(str3, ctx.indent, commentString(keyComment));
        str3 = `? ${str3}
${indent}:`;
      } else {
        str3 = `${str3}:`;
        if (keyComment)
          str3 += stringifyComment.lineComment(str3, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str3.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str3 += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str3 += stringifyComment.lineComment(str3, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str3;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str4 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str4 += stringifyComment.lineComment(str4, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str4);
      }
      let str3;
      if (lines.length === 0) {
        str3 = flowChars.start + flowChars.end;
      } else {
        str3 = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str3 += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str3 += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str3;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str3 = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str3.includes("\n"));
        if (i < items.length - 1) {
          str3 += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str3.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str3 += ",";
          }
        }
        if (comment)
          str3 += stringifyComment.lineComment(str3, itemIndent, commentString(comment));
        lines.push(str3);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str3 = start;
          for (const line of lines)
            str3 += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str3}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string2 = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str3) => str3,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string2;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str3) => new Scalar.Scalar(str3[0] === "t" || str3[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str3) => str3.slice(-3).toLowerCase() === "nan" ? NaN : str3[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str3) => parseFloat(str3),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str3) {
        const node = new Scalar.Scalar(parseFloat(str3));
        const dot = str3.indexOf(".");
        if (dot !== -1 && str3[str3.length - 1] === "0")
          node.minFractionDigits = str3.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str3, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str3) : parseInt(str3.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string2 = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string2.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str3) => str3,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str3) => str3 === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str3, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str3) : parseInt(str3, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str3) => parseFloat(str3),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str3, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str3)}`);
        return str3;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str3 = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str3.length);
          for (let i = 0; i < str3.length; ++i)
            buffer[i] = str3.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str3;
        if (typeof node_buffer.Buffer === "function") {
          str3 = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str3 = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str3.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str3.substr(o, lineWidth);
          }
          str3 = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str3 }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str3) => str3.slice(-3).toLowerCase() === "nan" ? NaN : str3[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str3) => parseFloat(str3.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str3) {
        const node = new Scalar.Scalar(parseFloat(str3.replace(/_/g, "")));
        const dot = str3.indexOf(".");
        if (dot !== -1) {
          const f = str3.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str3, offset, radix, { intAsBigInt }) {
      const sign = str3[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str3 = str3.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str3 = `0b${str3}`;
            break;
          case 8:
            str3 = `0o${str3}`;
            break;
          case 16:
            str3 = `0x${str3}`;
            break;
        }
        const n2 = BigInt(str3);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str3, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str3 = value.toString(radix);
        return value < 0 ? "-" + prefix + str3.substr(1) : prefix + str3;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str3, _onError, opt) => intResolve(str3, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str3, asBigInt) {
      const sign = str3[0];
      const parts = sign === "-" || sign === "+" ? str3.substring(1) : str3;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str3, _onError, { intAsBigInt }) => parseSexagesimal(str3, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str3) => parseSexagesimal(str3, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str3) {
        const match = str3.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string2 = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string2.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string2 = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string2.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string2 = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string2.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count3, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count3);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count3 = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count3 = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count3);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field2, index] of path) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field2 = path[path.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field2, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field2 === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list2, type) {
      for (let i = 0; i < list2.length; ++i)
        if (list2[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list2) {
      for (let i = 0; i < list2.length; ++i) {
        switch (list2[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument2(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument2(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument2;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// packages/action/dist/main.js
import { randomUUID } from "node:crypto";

// packages/adapters/dist/http.js
var DEFAULT_TIMEOUT_MS = 1e4;
function networkReason(err, timeoutMs) {
  const e = err;
  if (e?.name === "TimeoutError" || e?.name === "AbortError")
    return `no response within ${timeoutMs / 1e3} s`;
  const code = e?.cause?.code;
  return code ? `could not connect (${code})` : "could not connect";
}
async function fetchLimited(url2, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  let res;
  try {
    res = await (opts.fetch ?? fetch)(url2, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": opts.userAgent ?? "seamkit", accept: opts.accept ?? "*/*" }
    });
  } catch (err) {
    return { ok: false, reason: networkReason(err, timeoutMs) };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => void 0);
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => void 0);
    return { ok: false, status: res.status, reason: `larger than ${maxBytes} bytes` };
  }
  const chunks = [];
  let size = 0;
  try {
    if (res.body !== null) {
      for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          await res.body.cancel().catch(() => void 0);
          return { ok: false, status: res.status, reason: `larger than ${maxBytes} bytes` };
        }
        chunks.push(Buffer.from(chunk));
      }
    }
  } catch (err) {
    return { ok: false, status: res.status, reason: `the response stopped: ${networkReason(err, timeoutMs)}` };
  }
  return { ok: true, status: res.status, contentType: (res.headers.get("content-type") ?? "").toLowerCase(), body: Buffer.concat(chunks) };
}
function isHtml(f) {
  if (f.contentType.startsWith("text/html"))
    return true;
  const head = f.body.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

// packages/adapters/dist/version.js
import { createHash as createHash2 } from "node:crypto";

// packages/core/dist/outcome.js
var OUTCOMES = ["pass", "examined_nothing", "unclassified", "fail"];
var SEVERITY = {
  pass: 0,
  examined_nothing: 1,
  unclassified: 2,
  fail: 3
};
var EXIT_CODES = {
  pass: 0,
  fail: 1,
  examined_nothing: 3,
  unclassified: 4
};
var EXIT_USAGE = 2;
function isOutcome(value) {
  return typeof value === "string" && OUTCOMES.includes(value);
}
function exitCodeFor(outcome) {
  return EXIT_CODES[outcome];
}
function combine(outcomes) {
  let worst;
  for (const outcome of outcomes) {
    if (!isOutcome(outcome))
      throw new TypeError(`not an outcome: ${String(outcome)}`);
    if (worst === void 0 || SEVERITY[outcome] > SEVERITY[worst])
      worst = outcome;
  }
  return worst ?? "examined_nothing";
}
var OUTCOME_LABELS = {
  pass: "PASS",
  fail: "FAIL",
  examined_nothing: "EXAMINED NOTHING",
  unclassified: "UNCLASSIFIED"
};

// packages/core/dist/canonical.js
import { createHash } from "node:crypto";
var CanonicalJsonError = class extends Error {
  name = "CanonicalJsonError";
};
var LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function canonicalJson(value) {
  return serialize(value, "$");
}
function serialize(value, path) {
  if (value === null)
    return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value))
        throw new CanonicalJsonError(`${path}: non-finite number`);
      return JSON.stringify(value);
    case "string":
      if (LONE_SURROGATE.test(value))
        throw new CanonicalJsonError(`${path}: string contains a lone surrogate`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(`${path}: ${typeof value} is not JSON data`);
  }
  if (Array.isArray(value)) {
    const items = value.map((item, i) => {
      if (item === void 0)
        throw new CanonicalJsonError(`${path}[${i}]: undefined inside an array`);
      return serialize(item, `${path}[${i}]`);
    });
    return `[${items.join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalJsonError(`${path}: only plain objects are JSON data`);
  }
  const record = value;
  const keys = Object.keys(record).filter((key) => record[key] !== void 0).sort();
  const members = keys.map((key) => {
    if (LONE_SURROGATE.test(key))
      throw new CanonicalJsonError(`${path}: key contains a lone surrogate`);
    return `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`)}`;
  });
  return `{${members.join(",")}}`;
}
function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function digest(value) {
  return sha256Hex(canonicalJson(value));
}
var DIGEST_PATTERN = /^[0-9a-f]{64}$/;

// packages/core/dist/verdict.js
var VerdictInvariantError = class extends Error {
  violations;
  name = "VerdictInvariantError";
  constructor(violations) {
    super(`invalid verdict: ${violations.join("; ")}`);
    this.violations = violations;
  }
};
var ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
function isCount(n) {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
function verdictViolations(v) {
  const out = [];
  if (typeof v.check !== "string" || v.check.length === 0)
    out.push("check must be a non-empty string");
  if (typeof v.subject !== "string" || v.subject.length === 0)
    out.push("subject must be a non-empty string");
  if (!isOutcome(v.outcome))
    out.push(`outcome must be one of the four outcomes, got ${String(v.outcome)}`);
  if (typeof v.at !== "string" || !ISO_TIME.test(v.at))
    out.push("at must be an ISO 8601 UTC time");
  if (typeof v.inputs !== "string" || !DIGEST_PATTERN.test(v.inputs))
    out.push("inputs must be a sha256 hex digest");
  if (!Array.isArray(v.examined))
    out.push("examined must be an array");
  if (!Array.isArray(v.notExamined))
    out.push("notExamined must be an array, even when empty");
  if (!Array.isArray(v.evidence))
    out.push("evidence must be an array");
  if (!Array.isArray(v.reasons))
    out.push("reasons must be an array");
  if (out.length > 0)
    return out;
  v.examined.forEach((e, i) => {
    if (typeof e.item !== "string" || e.item.length === 0)
      out.push(`examined[${i}].item must be a non-empty string`);
    if (e.count !== void 0 && !isCount(e.count))
      out.push(`examined[${i}].count must be a non-negative integer`);
    if (e.of !== void 0 && !isCount(e.of))
      out.push(`examined[${i}].of must be a non-negative integer`);
    if (isCount(e.count) && isCount(e.of) && e.count > e.of)
      out.push(`examined[${i}].count exceeds its denominator`);
  });
  v.notExamined.forEach((g, i) => {
    if (typeof g.item !== "string" || g.item.length === 0)
      out.push(`notExamined[${i}].item must be a non-empty string`);
    if (typeof g.reason !== "string" || g.reason.length === 0)
      out.push(`notExamined[${i}].reason must be a non-empty string`);
  });
  if (v.outcome === "pass" && !v.examined.some((e) => e.count === void 0 || e.count > 0)) {
    out.push("a pass must have examined at least one thing (zero rows is never a pass)");
  }
  if (v.outcome !== "pass" && v.reasons.length === 0) {
    out.push(`a ${v.outcome} verdict must give at least one reason`);
  }
  return out;
}
function assertVerdict(v) {
  const violations = verdictViolations(v);
  if (violations.length > 0)
    throw new VerdictInvariantError(violations);
  return v;
}
function finalize(draft, defaults) {
  const v = {
    check: draft.check ?? defaults.check,
    subject: draft.subject,
    outcome: draft.outcome,
    examined: draft.examined,
    notExamined: draft.notExamined ?? [],
    evidence: draft.evidence ?? [],
    reasons: draft.reasons ?? [],
    inputs: defaults.inputs,
    at: defaults.at
  };
  if (draft.state !== void 0)
    v.state = draft.state;
  return assertVerdict(v);
}

// packages/core/dist/compose.js
function compose(check, subject, parts, at2) {
  const outcome = combine(parts.map((p) => p.outcome));
  const reasons = parts.length === 0 ? ["no checks were evaluated, so nothing was examined"] : parts.filter((p) => p.outcome !== "pass").flatMap((p) => p.reasons.map((r) => `${p.check} (${p.subject}): ${r}`));
  return assertVerdict({
    check,
    subject,
    outcome,
    examined: parts.flatMap((p) => p.examined.map((e) => ({ ...e, item: `${p.check} (${p.subject}): ${e.item}` }))),
    notExamined: parts.flatMap((p) => p.notExamined.map((g) => ({ ...g, item: `${p.check} (${p.subject}): ${g.item}` }))),
    evidence: parts.flatMap((p) => p.evidence),
    reasons,
    inputs: digest({ compose: check, subject, parts: parts.map((p) => p.inputs) }),
    at: at2
  });
}

// packages/core/dist/check.js
var InputError = class extends Error {
  name = "InputError";
};
function runCheck(def, rawInput2, at2) {
  const input2 = def.parseInput(rawInput2);
  const record = { check: def.name, version: def.version, input: rawInput2 };
  const inputs = digest(record);
  const drafts = def.evaluate(input2, { at: at2 });
  const list2 = Array.isArray(drafts) ? drafts : [drafts];
  if (list2.length === 0)
    throw new Error(`check ${def.name}@${def.version} returned no verdicts`);
  return { record, verdicts: list2.map((d) => finalize(d, { check: def.name, inputs, at: at2 })) };
}
var CheckRegistry = class {
  defs = /* @__PURE__ */ new Map();
  register(def) {
    const key = `${def.name}@${def.version}`;
    if (this.defs.has(key))
      throw new Error(`check ${key} is already registered`);
    if (!Number.isInteger(def.version) || def.version < 1)
      throw new Error(`check ${def.name} has an invalid version`);
    this.defs.set(key, def);
    return this;
  }
  /** The exact version, or the latest version when none is given. */
  get(name, version) {
    if (version !== void 0)
      return this.defs.get(`${name}@${version}`);
    let latest;
    for (const def of this.defs.values()) {
      if (def.name === name && (latest === void 0 || def.version > latest.version))
        latest = def;
    }
    return latest;
  }
  list() {
    return [...this.defs.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version - b.version);
  }
};
function replayRun(registry, recorded) {
  const { record, verdicts } = recorded;
  const verdictCount = Array.isArray(verdicts) ? verdicts.length : 0;
  const first = verdicts?.[0];
  if (first === void 0) {
    return { status: "not_replayable", reasons: ["the recorded run holds no verdicts"], verdictCount };
  }
  const def = registry.get(record.check, record.version);
  if (def === void 0) {
    return {
      status: "not_replayable",
      reasons: [`check ${record.check}@${record.version} is not known to this version of seamkit`],
      verdictCount
    };
  }
  const expectedInputs = digest(record);
  const reasons = [];
  verdicts.forEach((v, i) => {
    if (v.inputs !== expectedInputs)
      reasons.push(`verdict ${i}: inputs digest does not match the recorded input`);
  });
  let recomputed;
  try {
    recomputed = runCheck(def, record.input, first.at);
  } catch (err) {
    reasons.push(`recomputing failed: ${err.message}`);
    return { status: "mismatch", reasons, verdictCount };
  }
  if (recomputed.verdicts.length !== verdicts.length) {
    reasons.push(`recorded ${verdicts.length} verdicts, recomputed ${recomputed.verdicts.length}`);
  } else {
    recomputed.verdicts.forEach((v, i) => {
      const was = verdicts[i];
      if (canonicalJson(v) === canonicalJson(was))
        return;
      const fields = /* @__PURE__ */ new Set([...Object.keys(v), ...Object.keys(was)]);
      for (const field2 of [...fields].sort()) {
        const a = was[field2];
        const b = v[field2];
        if (canonicalJson(a ?? null) !== canonicalJson(b ?? null)) {
          reasons.push(`verdict ${i}: ${field2} was ${canonicalJson(a ?? null)}, recomputed ${canonicalJson(b ?? null)}`);
        }
      }
    });
  }
  return { status: reasons.length === 0 ? "match" : "mismatch", reasons, verdictCount };
}

// packages/core/dist/event.js
var EVENT_VERSION = 1;
var ACTOR_KINDS = ["human", "agent", "ci", "unknown"];
var KNOWN_EVENT_KINDS = ["verdict"];
function eventJson(event) {
  return canonicalJson(event);
}
function eventId(event) {
  return sha256Hex(eventJson(event));
}
function eventFileContent(event) {
  return `${eventJson(event)}
`;
}
var ISO_TIME2 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
function eventPath(at2, id) {
  const m = ISO_TIME2.exec(at2);
  if (m === null)
    throw new Error(`event time is not an ISO 8601 UTC time: ${at2}`);
  const [, y, mo, d, h, mi, s, frac] = m;
  return `events/${y}/${mo}/${d}/${y}${mo}${d}T${h}${mi}${s}${frac ?? ""}Z-${id}.json`;
}
var EVENT_PATH_PATTERN = /^events\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{8}T\d{6,15}Z)-([0-9a-f]{64})\.json$/;
function parseEventFile(path, content) {
  const problems = [];
  const m = EVENT_PATH_PATTERN.exec(path);
  if (m === null)
    return { ok: false, problems: [`path does not match events/YYYY/MM/DD/<time>-<sha256>.json`] };
  const id = m[5];
  if (!content.endsWith("\n") || content.endsWith("\n\n"))
    problems.push("file must end with exactly one newline");
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, problems: [...problems, "file is not valid JSON"] };
  }
  let canonical;
  try {
    canonical = canonicalJson(parsed);
  } catch (err) {
    problems.push(`content is not canonical JSON data: ${err.message}`);
  }
  if (canonical !== void 0 && canonical !== body)
    problems.push("content is not in canonical form");
  if (sha256Hex(body) !== id)
    problems.push("sha256 of the content does not match the id in the file name");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problems: [...problems, "event must be a JSON object"] };
  }
  const event = parsed;
  const kind = typeof event["kind"] === "string" ? event["kind"] : "";
  const known = KNOWN_EVENT_KINDS.includes(kind);
  if (known)
    problems.push(...eventViolations(event));
  else if (kind === "")
    problems.push("event has no kind");
  if (typeof event["at"] === "string") {
    try {
      const expected = eventPath(event["at"], id);
      if (expected !== path)
        problems.push(`path does not match the event time (expected ${expected})`);
    } catch (err) {
      problems.push(err.message);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, id, kind, known, event };
}
function eventViolations(e) {
  const out = [];
  if (e["v"] !== EVENT_VERSION)
    out.push(`v must be ${EVENT_VERSION}`);
  if (e["kind"] !== "verdict")
    out.push(`unknown kind ${String(e["kind"])}`);
  if (typeof e["at"] !== "string" || !ISO_TIME2.test(e["at"]))
    out.push("at must be an ISO 8601 UTC time");
  const actor = e["actor"];
  if (typeof actor !== "object" || actor === null)
    out.push("actor must be an object");
  else {
    if (!ACTOR_KINDS.includes(actor["kind"]))
      out.push("actor.kind is not a known kind");
    for (const f of ["handle", "harness", "session"]) {
      if (actor[f] !== void 0 && typeof actor[f] !== "string")
        out.push(`actor.${f} must be a string`);
    }
    if (typeof actor["handle"] === "string" && actor["handle"].includes("@")) {
      out.push("actor.handle must be a handle, not an email address");
    }
  }
  const tool = e["tool"];
  if (typeof tool !== "object" || tool === null || tool["name"] !== "seamkit" || typeof tool["version"] !== "string") {
    out.push('tool must be {name: "seamkit", version}');
  }
  const body = e["body"];
  const run2 = body?.["run"];
  if (typeof run2 !== "object" || run2 === null) {
    out.push("body.run must be an object");
    return out;
  }
  const record = run2["record"];
  if (typeof record !== "object" || record === null)
    out.push("body.run.record must be an object");
  else {
    if (typeof record["check"] !== "string" || record["check"].length === 0)
      out.push("record.check must be a string");
    if (!Number.isInteger(record["version"]) || record["version"] < 1)
      out.push("record.version must be a positive integer");
    if (!("input" in record))
      out.push("record.input is missing");
  }
  const verdicts = run2["verdicts"];
  if (!Array.isArray(verdicts) || verdicts.length === 0)
    out.push("body.run.verdicts must be a non-empty array");
  else
    verdicts.forEach((v, i) => out.push(...verdictViolations(v).map((x) => `verdicts[${i}]: ${x}`)));
  return out;
}

// packages/core/dist/replay.js
function replayVerdict(registry, eventId2, run2, at2) {
  const result = replayRun(registry, run2);
  const label = `${run2.record.check}@${run2.record.version}`;
  const base = {
    check: "replay",
    subject: `event:${eventId2.slice(0, 12)}`,
    inputs: digest({ replay: eventId2 }),
    at: at2,
    evidence: [{ kind: "event", value: eventId2 }]
  };
  if (result.status === "match") {
    return assertVerdict({
      ...base,
      outcome: "pass",
      state: "match",
      examined: [{ item: `recorded verdicts of ${label}`, count: result.verdictCount }],
      notExamined: [],
      reasons: []
    });
  }
  if (result.status === "mismatch") {
    return assertVerdict({
      ...base,
      outcome: "fail",
      state: "mismatch",
      examined: [{ item: `recorded verdicts of ${label}`, count: result.verdictCount }],
      notExamined: [],
      reasons: result.reasons
    });
  }
  return assertVerdict({
    ...base,
    outcome: "examined_nothing",
    state: "not_replayable",
    examined: [],
    notExamined: [{ item: `recorded verdicts of ${label}`, reason: result.reasons.join("; ") }],
    reasons: result.reasons
  });
}

// packages/core/dist/render.js
var asLines = (lines) => lines.map((l) => l.replace(/[\r\n\u0085\u2028\u2029]+/g, " ")).join("\n");
function examinedText(e) {
  if (e.count === void 0)
    return e.item;
  return e.of === void 0 ? `${e.item} (${e.count})` : `${e.item} (${e.count} of ${e.of})`;
}
function renderVerdict(v) {
  const lines = [`${OUTCOME_LABELS[v.outcome]}  ${v.check}  ${v.subject}${v.state ? `  (${v.state})` : ""}`];
  for (const r of v.reasons)
    lines.push(`  why: ${r}`);
  if (v.examined.length === 0)
    lines.push("  examined: nothing");
  for (const e of v.examined)
    lines.push(`  examined: ${examinedText(e)}`);
  if (v.notExamined.length === 0)
    lines.push("  not examined: none listed");
  for (const g of v.notExamined)
    lines.push(`  not examined: ${g.item} (${g.reason})`);
  for (const ev of v.evidence)
    lines.push(`  evidence: ${ev.label ? `${ev.label} ` : ""}${ev.value}`);
  return asLines(lines);
}
function renderSummary(verdicts) {
  const counts = /* @__PURE__ */ new Map();
  for (const v of verdicts)
    counts.set(v.outcome, (counts.get(v.outcome) ?? 0) + 1);
  const parts = OUTCOMES.filter((o) => counts.has(o)).map((o) => `${counts.get(o)} ${OUTCOME_LABELS[o].toLowerCase()}`);
  const noun = verdicts.length === 1 ? "verdict" : "verdicts";
  return parts.length === 0 ? `0 ${noun}` : `${verdicts.length} ${noun}: ${parts.join(", ")}`;
}
function explanation(v) {
  return [...v.reasons, ...v.notExamined.filter((g) => !v.reasons.includes(`${g.item}: ${g.reason}`)).map((g) => `not examined: ${g.item} (${g.reason})`)];
}
var READBACK_GROUPS = [
  ["not_live", "NOT LIVE"],
  ["not_proven", "NOT PROVEN"],
  ["nothing_to_prove", "NOTHING TO PROVE"],
  ["live", "LIVE"]
];
function renderReadback(verdicts) {
  const [summary, ...parts] = verdicts;
  if (summary === void 0)
    return "0 verdicts";
  const total = parts.length;
  const width = Math.max(0, ...parts.map((p) => p.subject.length));
  const lines = [];
  for (const [state, label] of READBACK_GROUPS) {
    const group = parts.filter((p) => p.state === state);
    if (group.length === 0)
      continue;
    const outcomes = OUTCOMES.filter((o) => group.some((p) => p.outcome === o)).map((o) => `${group.filter((p) => p.outcome === o).length} ${OUTCOME_LABELS[o].toLowerCase()}`);
    lines.push(`${label}  ${group.length} of ${total}  (${outcomes.join(", ")})`);
    const clusters = /* @__PURE__ */ new Map();
    for (const p of group) {
      const key = JSON.stringify([p.outcome, explanation(p)]);
      clusters.set(key, [...clusters.get(key) ?? [], p]);
    }
    const title = (p) => p.evidence.find((e) => e.label === "title")?.value ?? "";
    for (const members of clusters.values()) {
      const first = members[0];
      if (members.length >= 3) {
        lines.push(`  ${members.length} changes, each for the same reason:`);
        for (const line of explanation(first))
          lines.push(`      ${line}`);
        for (const p of members)
          lines.push(`    ${p.subject.padEnd(width)}  ${title(p)}`);
        continue;
      }
      for (const p of members) {
        lines.push(`  ${p.subject.padEnd(width)}  ${title(p)}`);
        for (const line of explanation(p))
          lines.push(`${" ".repeat(width + 4)}${line}`);
      }
    }
    lines.push("");
  }
  const prefixes = parts.map((p) => `${p.subject}: `);
  const runGaps = summary.notExamined.filter((g) => !prefixes.some((prefix) => g.item.startsWith(prefix)));
  lines.push(`${OUTCOME_LABELS[summary.outcome]}  ${summary.check}  ${summary.subject}`);
  for (const r of summary.reasons)
    lines.push(`  ${r}`);
  for (const g of runGaps)
    lines.push(`  not examined: ${g.item} (${g.reason})`);
  const perChange = summary.notExamined.length - runGaps.length;
  if (perChange > 0)
    lines.push(`  not examined: ${perChange} item${perChange === 1 ? "" : "s"} listed with the changes above`);
  if (summary.notExamined.length === 0)
    lines.push("  not examined: none listed");
  return asLines(lines);
}

// packages/core/dist/validate.js
function fail(message) {
  throw new InputError(message);
}
var ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
var COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function object(value, path, allowed) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${path} must be a JSON object`);
  const obj = value;
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0)
    fail(`${path} has unknown field(s): ${unknown.join(", ")}; allowed: ${allowed.join(", ")}`);
  return obj;
}
function string(value, path) {
  if (typeof value !== "string" || value.trim().length === 0)
    fail(`${path} must be a non-empty string`);
  return value;
}
function matching(value, path, pattern, what) {
  if (typeof value !== "string" || !pattern.test(value))
    fail(`${path} must be ${what}, got ${JSON.stringify(value)}`);
  return value;
}
function commit(value, path) {
  return matching(value, path, COMMIT_PATTERN, "a full lower-case commit id (40 or 64 hex characters)");
}
function isoTime(value, path) {
  return matching(value, path, ISO_TIME_PATTERN, "an ISO 8601 UTC time such as 2026-10-14T12:00:00.000Z");
}
function digestHex(value, path) {
  return matching(value, path, DIGEST_PATTERN, "a sha256 hex digest");
}
function count(value, path) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(`${path} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}
function boolean(value, path) {
  if (typeof value !== "boolean")
    fail(`${path} must be true or false, got ${JSON.stringify(value)}`);
  return value;
}
function oneOf(value, path, options) {
  if (typeof value !== "string" || !options.includes(value)) {
    fail(`${path} must be one of ${options.join(", ")}; got ${JSON.stringify(value)}`);
  }
  return value;
}
function array(value, path, item, max = Infinity) {
  if (!Array.isArray(value))
    fail(`${path} must be an array`);
  if (value.length > max)
    fail(`${path} holds at most ${max} entries, got ${value.length}`);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}
function httpUrl(value, path) {
  const text = string(value, path);
  let url2;
  try {
    url2 = new URL(text);
  } catch {
    fail(`${path} must be an absolute http or https URL, got ${JSON.stringify(text)}`);
  }
  if (url2.protocol !== "http:" && url2.protocol !== "https:")
    fail(`${path} must use http or https, got ${url2.protocol}`);
  if (url2.username !== "" || url2.password !== "")
    fail(`${path} must not contain a user name or password`);
  return text;
}
function unique(items, path, key) {
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k))
      fail(`${path} lists ${k} more than once`);
    seen.add(k);
  }
}

// packages/core/dist/version-doc.js
var VERSION_DOC_SCHEMA = "seamkit.version/1";
function versionDocText(doc) {
  const ordered = {
    schema: doc.schema,
    commit: doc.commit,
    dirty: doc.dirty,
    source: doc.source,
    ref: doc.ref,
    builtAt: doc.builtAt
  };
  return `${JSON.stringify(ordered, null, 2)}
`;
}
var ABBREVIATED = /^[0-9a-fA-F]{7,64}$/;
var COMMIT_FIELDS = [
  "commit",
  "sha",
  "commitSha",
  "commit_sha",
  "gitSha",
  "git_sha",
  "gitCommit",
  "git_commit",
  "revision",
  "git.commit",
  "git.sha",
  "git.commit.id",
  "build.commit"
];
function at(doc, path) {
  let value = doc;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return void 0;
    value = value[key];
  }
  return value;
}
function flag(value) {
  if (typeof value === "boolean")
    return value;
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  return void 0;
}
function readVersionDoc(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, problem: "the response is not JSON" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, problem: "the response is JSON but not an object" };
  }
  const record = doc;
  if (record["schema"] === VERSION_DOC_SCHEMA) {
    const commit2 = record["commit"];
    if (typeof commit2 !== "string" || !COMMIT_PATTERN.test(commit2)) {
      return { ok: false, problem: `the ${VERSION_DOC_SCHEMA} document's commit is not a full lower-case commit id` };
    }
    const dirty2 = record["dirty"];
    if (dirty2 !== void 0 && typeof dirty2 !== "boolean") {
      return { ok: false, problem: `the ${VERSION_DOC_SCHEMA} document's dirty field is not true or false` };
    }
    return dirty2 === void 0 ? { ok: true, commit: commit2, field: "commit" } : { ok: true, commit: commit2, field: "commit", dirty: dirty2 };
  }
  const found = [];
  const unusable = [];
  for (const field2 of COMMIT_FIELDS) {
    const value = at(doc, field2);
    if (value === void 0 || value === null || typeof value === "object")
      continue;
    if (typeof value === "string" && ABBREVIATED.test(value))
      found.push({ field: field2, commit: value.toLowerCase() });
    else
      unusable.push(field2);
  }
  if (found.length === 0) {
    return {
      ok: false,
      problem: unusable.length > 0 ? `field ${unusable.join(", ")} holds no commit id` : `the document names no commit (looked for ${COMMIT_FIELDS.join(", ")})`
    };
  }
  const longest = found.reduce((a, b) => b.commit.length > a.commit.length ? b : a);
  const disagreeing = found.filter((f) => !longest.commit.startsWith(f.commit));
  if (disagreeing.length > 0) {
    return { ok: false, problem: `fields ${longest.field} and ${disagreeing[0].field} name different commits` };
  }
  const dirty = flag(record["dirty"]) ?? flag(at(doc, "git.dirty"));
  return dirty === void 0 ? { ok: true, commit: longest.commit, field: longest.field } : { ok: true, commit: longest.commit, field: longest.field, dirty };
}

// packages/core/dist/checks/invariant.js
var KEYS = /* @__PURE__ */ new Set(["subject", "scope", "examined", "violations", "samples", "notExamined"]);
var MAX_SAMPLES = 20;
function fail2(message) {
  throw new InputError(message);
}
function nonEmptyString(value, field2) {
  if (typeof value !== "string" || value.trim().length === 0)
    fail2(`${field2} must be a non-empty string`);
  return value;
}
function count2(value, field2) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail2(`${field2} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}
var invariantCheck = {
  name: "invariant",
  version: 1,
  summary: "An invariant over rows: passes only when rows were examined and none violate it.",
  parseInput(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      fail2("input must be a JSON object");
    const obj = raw;
    const unknown = Object.keys(obj).filter((k) => !KEYS.has(k));
    if (unknown.length > 0)
      fail2(`unknown field(s): ${unknown.join(", ")}; allowed: ${[...KEYS].join(", ")}`);
    const input2 = {
      subject: nonEmptyString(obj["subject"], "subject"),
      scope: nonEmptyString(obj["scope"], "scope"),
      examined: count2(obj["examined"], "examined"),
      violations: count2(obj["violations"], "violations")
    };
    if (input2.violations > input2.examined) {
      fail2(`violations (${input2.violations}) cannot exceed examined (${input2.examined})`);
    }
    if (obj["samples"] !== void 0) {
      const samples = obj["samples"];
      if (!Array.isArray(samples) || samples.some((s) => typeof s !== "string"))
        fail2("samples must be an array of strings");
      if (samples.length > MAX_SAMPLES)
        fail2(`samples holds at most ${MAX_SAMPLES} entries`);
      input2.samples = samples;
    }
    if (obj["notExamined"] !== void 0) {
      const gaps = obj["notExamined"];
      if (!Array.isArray(gaps))
        fail2("notExamined must be an array of {item, reason}");
      input2.notExamined = gaps.map((g, i) => {
        if (typeof g !== "object" || g === null)
          fail2(`notExamined[${i}] must be an object`);
        const gap = g;
        return { item: nonEmptyString(gap["item"], `notExamined[${i}].item`), reason: nonEmptyString(gap["reason"], `notExamined[${i}].reason`) };
      });
    }
    return input2;
  },
  evaluate(input2) {
    const notExamined = input2.notExamined ?? [];
    if (input2.examined === 0) {
      return {
        subject: input2.subject,
        outcome: "examined_nothing",
        state: "no_rows",
        examined: [{ item: input2.scope, count: 0 }],
        notExamined,
        reasons: [`no rows were in scope (${input2.scope}), and a check over zero rows is not a pass`]
      };
    }
    const evidence = [
      { kind: "count", value: `${input2.violations}/${input2.examined}`, label: "violating rows" },
      ...(input2.samples ?? []).map((s) => ({ kind: "text", value: s, label: "sample" }))
    ];
    if (input2.violations > 0) {
      return {
        subject: input2.subject,
        outcome: "fail",
        state: "violated",
        examined: [{ item: input2.scope, count: input2.examined }],
        notExamined,
        evidence,
        reasons: [`${input2.violations} of ${input2.examined} rows violate ${input2.subject}`]
      };
    }
    return {
      subject: input2.subject,
      outcome: "pass",
      state: "held",
      examined: [{ item: input2.scope, count: input2.examined }],
      notExamined,
      evidence
    };
  }
};

// packages/core/dist/checks/readback.js
var MIN_MARKER_TEXT = 4;
function markerKey(m) {
  switch (m.kind) {
    case "bundle":
      return canonicalJson(["bundle", m.url, m.text]);
    case "version":
      return canonicalJson(["version", m.url]);
    case "db_object":
      return canonicalJson(["db_object", m.object]);
    case "none":
      return canonicalJson(["none"]);
  }
}
function parseMarker(raw, path) {
  const kind = oneOf(object(raw, path, ["kind", "url", "text", "object", "reason"])["kind"], `${path}.kind`, [
    "bundle",
    "version",
    "db_object",
    "none"
  ]);
  switch (kind) {
    case "bundle": {
      const o = object(raw, path, ["kind", "url", "text"]);
      const text = string(o["text"], `${path}.text`);
      if (text.trim().length < MIN_MARKER_TEXT)
        fail(`${path}.text must be at least ${MIN_MARKER_TEXT} characters, so it can only match this change`);
      if (text.length > 200)
        fail(`${path}.text must be at most 200 characters`);
      return { kind, url: httpUrl(o["url"], `${path}.url`), text };
    }
    case "version": {
      const o = object(raw, path, ["kind", "url"]);
      return { kind, url: httpUrl(o["url"], `${path}.url`) };
    }
    case "db_object": {
      const o = object(raw, path, ["kind", "object"]);
      return { kind, object: string(o["object"], `${path}.object`) };
    }
    case "none": {
      const o = object(raw, path, ["kind", "reason"]);
      return { kind, reason: string(o["reason"], `${path}.reason`) };
    }
  }
}
function parseChange(raw, path) {
  const o = object(raw, path, ["subject", "commit", "title", "markerSource", "markers", "cardProblems"]);
  const change = {
    subject: string(o["subject"], `${path}.subject`),
    commit: commit(o["commit"], `${path}.commit`),
    title: string(o["title"], `${path}.title`),
    markerSource: oneOf(o["markerSource"], `${path}.markerSource`, ["card", "implicit"]),
    markers: array(o["markers"], `${path}.markers`, parseMarker, 20)
  };
  if (o["cardProblems"] !== void 0) {
    change.cardProblems = array(o["cardProblems"], `${path}.cardProblems`, string, 20);
    if (change.markerSource === "card")
      fail(`${path}.cardProblems is only allowed with markerSource implicit`);
  }
  const none = change.markers.filter((m) => m.kind === "none");
  if (none.length > 0 && change.markers.length > 1)
    fail(`${path}.markers: a none marker must be the only marker`);
  if (change.markerSource === "implicit" && change.markers.some((m) => m.kind !== "version")) {
    fail(`${path}.markers: implicit markers can only be version markers`);
  }
  unique(change.markers, `${path}.markers`, markerKey);
  return change;
}
function parseVersion(raw, path) {
  const o = object(raw, path, ["url", "at", "status", "reported", "commit", "dirty", "digest", "reason"]);
  const obs = {
    url: httpUrl(o["url"], `${path}.url`),
    at: isoTime(o["at"], `${path}.at`),
    status: oneOf(o["status"], `${path}.status`, ["ok", "unreadable"])
  };
  if (obs.status === "unreadable") {
    obs.reason = string(o["reason"], `${path}.reason`);
    for (const f of ["reported", "commit", "dirty", "digest"]) {
      if (o[f] !== void 0)
        fail(`${path}.${f} is only allowed when status is ok`);
    }
    return obs;
  }
  obs.reported = matching(o["reported"], `${path}.reported`, /^[0-9a-f]{7,64}$/, "the commit as reported, in lower-case hex");
  if (o["commit"] !== void 0) {
    obs.commit = commit(o["commit"], `${path}.commit`);
    if (!obs.commit.startsWith(obs.reported))
      fail(`${path}.commit does not start with the reported commit`);
  }
  if (o["dirty"] !== void 0)
    obs.dirty = boolean(o["dirty"], `${path}.dirty`);
  obs.digest = digestHex(o["digest"], `${path}.digest`);
  if (o["reason"] !== void 0)
    fail(`${path}.reason is only allowed when status is unreadable`);
  return obs;
}
function parseAncestry(raw, path) {
  const o = object(raw, path, ["change", "running", "contains", "reason"]);
  const contains = o["contains"] === null ? null : boolean(o["contains"], `${path}.contains`);
  const fact = {
    change: commit(o["change"], `${path}.change`),
    running: commit(o["running"], `${path}.running`),
    contains
  };
  if (o["reason"] !== void 0)
    fact.reason = string(o["reason"], `${path}.reason`);
  return fact;
}
function parseBundle(raw, path) {
  const o = object(raw, path, ["url", "at", "status", "complete", "files", "bytes", "digest", "searched", "found", "versionUrl", "otherOrigins", "reason"]);
  const obs = {
    url: httpUrl(o["url"], `${path}.url`),
    at: isoTime(o["at"], `${path}.at`),
    status: oneOf(o["status"], `${path}.status`, ["ok", "unreadable"]),
    complete: boolean(o["complete"], `${path}.complete`),
    files: count(o["files"], `${path}.files`),
    bytes: count(o["bytes"], `${path}.bytes`),
    searched: array(o["searched"], `${path}.searched`, string, 1e3),
    found: array(o["found"], `${path}.found`, string, 1e3)
  };
  if (o["digest"] !== void 0)
    obs.digest = digestHex(o["digest"], `${path}.digest`);
  if (o["versionUrl"] !== void 0)
    obs.versionUrl = httpUrl(o["versionUrl"], `${path}.versionUrl`);
  if (o["otherOrigins"] !== void 0)
    obs.otherOrigins = array(o["otherOrigins"], `${path}.otherOrigins`, string, 20);
  if (o["reason"] !== void 0)
    obs.reason = string(o["reason"], `${path}.reason`);
  const searched = new Set(obs.searched);
  for (const text of obs.found)
    if (!searched.has(text))
      fail(`${path}.found lists text that was not searched for`);
  if (obs.status === "ok") {
    if (obs.files < 1)
      fail(`${path}.files must be at least 1 when status is ok (the page itself)`);
    if (obs.digest === void 0)
      fail(`${path}.digest is required when status is ok`);
    if (!obs.complete && obs.reason === void 0)
      fail(`${path}.reason must say why the search was incomplete`);
  } else {
    if (obs.reason === void 0)
      fail(`${path}.reason is required when status is unreadable`);
    if (obs.complete || obs.found.length > 0)
      fail(`${path}: an unreadable page can be neither complete nor have found anything`);
  }
  return obs;
}
function parseSighting(raw, path) {
  const o = object(raw, path, ["change", "marker", "at", "event"]);
  return {
    change: commit(o["change"], `${path}.change`),
    marker: string(o["marker"], `${path}.marker`),
    at: isoTime(o["at"], `${path}.at`),
    event: digestHex(o["event"], `${path}.event`)
  };
}
function parseGap(raw, path) {
  const o = object(raw, path, ["item", "reason"]);
  return { item: string(o["item"], `${path}.item`), reason: string(o["reason"], `${path}.reason`) };
}
function parseReadbackInput(raw) {
  const o = object(raw, "input", ["subject", "changes", "versions", "ancestry", "bundles", "history", "notExamined"]);
  const input2 = {
    subject: string(o["subject"], "subject"),
    changes: array(o["changes"], "changes", parseChange, 1e3),
    versions: array(o["versions"], "versions", parseVersion, 100),
    ancestry: array(o["ancestry"], "ancestry", parseAncestry, 1e5),
    bundles: array(o["bundles"], "bundles", parseBundle, 100),
    history: o["history"] === null ? null : array(o["history"], "history", parseSighting, 1e5)
  };
  if (o["notExamined"] !== void 0)
    input2.notExamined = array(o["notExamined"], "notExamined", parseGap, 100);
  unique(input2.changes, "changes", (c) => c.subject);
  unique(input2.changes, "changes", (c) => c.commit);
  unique(input2.versions, "versions", (o2) => o2.url);
  unique(input2.bundles, "bundles", (o2) => o2.url);
  unique(input2.ancestry, "ancestry", (f) => `${f.change} in ${f.running}`);
  const versionUrls = new Set(input2.versions.map((o2) => o2.url));
  input2.bundles.forEach((b, i) => {
    if (b.versionUrl !== void 0 && !versionUrls.has(b.versionUrl))
      fail(`bundles[${i}].versionUrl has no entry in versions`);
  });
  return input2;
}
var short = (commit2) => commit2.slice(0, 12);
var files = (n) => `${n} file${n === 1 ? "" : "s"}`;
var Facts = class {
  input;
  versions;
  bundles;
  ancestry;
  constructor(input2) {
    this.input = input2;
    this.versions = new Map(input2.versions.map((o) => [o.url, o]));
    this.bundles = new Map(input2.bundles.map((o) => [o.url, o]));
    this.ancestry = new Map(input2.ancestry.map((f) => [`${f.change} in ${f.running}`, f]));
  }
  /** Whether a usable version document says the change is in production; undefined when it cannot say. */
  containedBy(versionUrl, change) {
    const doc = versionUrl === void 0 ? void 0 : this.versions.get(versionUrl);
    if (doc?.status !== "ok" || doc.commit === void 0 || doc.dirty === true)
      return void 0;
    const fact = this.ancestry.get(`${change} in ${doc.commit}`);
    return fact === void 0 || fact.contains === null ? void 0 : { contains: fact.contains, running: doc.commit };
  }
};
function bundleStatus(facts, change, m) {
  const item = `bundle marker ${JSON.stringify(m.text)} at ${m.url}`;
  const obs = facts.bundles.get(m.url);
  if (obs === void 0)
    return { marker: m, status: "unreadable", gap: { item, reason: "no observation of this page was recorded" }, evidence: [] };
  if (obs.status === "unreadable")
    return { marker: m, status: "unreadable", gap: { item, reason: obs.reason }, evidence: [] };
  const evidence = [
    { kind: "url", value: m.url, label: "page" },
    { kind: "hash", value: obs.digest, label: "served files" }
  ];
  if (!obs.searched.includes(m.text)) {
    return { marker: m, status: "unreadable", gap: { item, reason: "the served files were read, but this text was not searched for" }, evidence };
  }
  const examined = { item, count: obs.files };
  const context = facts.containedBy(obs.versionUrl, change.commit);
  const where = `${files(obs.files)} served from ${m.url}`;
  if (obs.found.includes(m.text)) {
    if (context?.contains === false) {
      return {
        marker: m,
        status: "contradicted",
        why: `marker ${JSON.stringify(m.text)} was found, but production's version ${short(context.running)} does not contain this change, so the text is not unique to it; choose a marker that only this change adds`,
        examined,
        evidence
      };
    }
    return { marker: m, status: "present", why: `marker ${JSON.stringify(m.text)} found in ${where}`, examined, evidence };
  }
  if (!obs.complete) {
    return {
      marker: m,
      status: "unreadable",
      gap: { item, reason: `not found in the ${files(obs.files)} read, and the search was incomplete: ${obs.reason}` },
      evidence
    };
  }
  const elsewhere = obs.otherOrigins ?? [];
  const gap = elsewhere.length === 0 ? void 0 : { item: `files on ${elsewhere.join(", ")}`, reason: "the page references them, but only files on its own origin are read" };
  let why = `marker ${JSON.stringify(m.text)} not found in ${where}`;
  if (context?.contains === true) {
    why += `, although production's version ${short(context.running)} contains this change; the text is probably not in the built output (text that exists only in source, such as a comment or a component name, never reaches a bundle)`;
  } else if (context?.contains === false) {
    why += `; production runs ${short(context.running)}, which does not contain this change`;
  }
  return gap === void 0 ? { marker: m, status: "absent", why, examined, evidence } : { marker: m, status: "absent", why, examined, evidence, gap };
}
function versionStatus(facts, change, m) {
  const item = `version document ${m.url}`;
  const doc = facts.versions.get(m.url);
  if (doc === void 0)
    return { marker: m, status: "unreadable", gap: { item, reason: "no observation of this document was recorded" }, evidence: [] };
  if (doc.status === "unreadable")
    return { marker: m, status: "unreadable", gap: { item, reason: doc.reason }, evidence: [] };
  const reported = doc.reported;
  if (doc.commit === void 0) {
    return {
      marker: m,
      status: "unreadable",
      gap: {
        item,
        reason: `production reports ${reported}, which this repository does not have; run git fetch, or look for a build made from a commit that was never pushed`
      },
      evidence: [{ kind: "url", value: m.url, label: "version document" }]
    };
  }
  const evidence = [
    { kind: "url", value: m.url, label: "version document" },
    { kind: "commit", value: doc.commit, label: "running version" }
  ];
  if (doc.dirty === true) {
    return {
      marker: m,
      status: "unreadable",
      gap: { item, reason: `production's build of ${short(doc.commit)} was made with uncommitted changes, so its version does not show what it contains` },
      evidence
    };
  }
  const fact = facts.ancestry.get(`${change.commit} in ${doc.commit}`);
  if (fact === void 0 || fact.contains === null) {
    return {
      marker: m,
      status: "unreadable",
      gap: { item, reason: fact?.reason ?? `whether ${short(doc.commit)} contains this change could not be determined` },
      evidence
    };
  }
  const examined = { item: `${item} (running ${short(doc.commit)})` };
  if (change.markerSource === "card") {
    const runs = `production at ${m.url} runs ${short(doc.commit)}`;
    return fact.contains ? { marker: m, status: "present", why: `${runs}, which contains this change`, examined, evidence } : { marker: m, status: "absent", why: `${runs}, which does not contain this change`, examined, evidence };
  }
  return fact.contains ? { marker: m, status: "present", why: `production's version ${short(doc.commit)} contains this change`, examined, evidence } : { marker: m, status: "absent", why: `production runs ${short(doc.commit)}, which does not contain this change`, examined, evidence };
}
function markerStatus(facts, change, m) {
  switch (m.kind) {
    case "bundle":
      return bundleStatus(facts, change, m);
    case "version":
      return versionStatus(facts, change, m);
    case "db_object":
      return {
        marker: m,
        status: "unreadable",
        gap: { item: `database object ${m.object}`, reason: "this version of seamkit has no adapter for database markers" },
        evidence: []
      };
    case "none":
      throw new Error("a none marker has no status");
  }
}
function latestSightings(history) {
  const latest = /* @__PURE__ */ new Map();
  for (const s of history) {
    const key = `${s.change} ${s.marker}`;
    const prev = latest.get(key);
    if (prev === void 0 || s.at > prev.at || s.at === prev.at && s.event > prev.event)
      latest.set(key, s);
  }
  return latest;
}
function changeEvidence(change) {
  return [
    { kind: "commit", value: change.commit, label: "change" },
    { kind: "text", value: change.title, label: "title" }
  ];
}
function dedupe(evidence) {
  const seen = /* @__PURE__ */ new Set();
  return evidence.filter((e) => {
    const key = canonicalJson(e);
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}
function evaluateChange(facts, change, seen) {
  const base = { subject: change.subject };
  const cardGap = change.cardProblems === void 0 ? [] : [{ item: "card markers", reason: `the card cannot be used: ${change.cardProblems.join("; ")}` }];
  const only = change.markers[0];
  if (change.markers.length === 1 && only?.kind === "none") {
    return {
      ...base,
      outcome: "examined_nothing",
      state: "nothing_to_prove",
      examined: [],
      evidence: changeEvidence(change),
      reasons: [`nothing to prove, as its card declares: ${only.reason}`]
    };
  }
  if (change.markers.length === 0) {
    return {
      ...base,
      outcome: "examined_nothing",
      state: "not_proven",
      examined: [],
      notExamined: cardGap,
      evidence: changeEvidence(change),
      reasons: [
        change.markerSource === "card" ? "its card lists no markers, so there is nothing to check it against" : "there is nothing to check this change against: it has no usable card, and production serves no version document"
      ]
    };
  }
  const statuses = change.markers.map((m) => markerStatus(facts, change, m));
  const read = statuses.filter((s) => s.status !== "unreadable");
  const unreadable = statuses.filter((s) => s.status === "unreadable");
  const evidence = [...changeEvidence(change), ...statuses.flatMap((s) => s.evidence)];
  const examined = read.map((s) => s.examined);
  const gaps = [...unreadable.map((s) => s.gap), ...read.flatMap((s) => s.gap === void 0 ? [] : [s.gap]), ...cardGap];
  const notLive = [];
  const failing = [];
  for (const s of read) {
    if (s.status === "contradicted")
      failing.push(s.why);
    if (s.status !== "absent")
      continue;
    const sighting = seen?.get(`${change.commit} ${markerKey(s.marker)}`);
    if (sighting === void 0) {
      failing.push(s.why);
    } else {
      notLive.push(`${s.why}; it was seen live at ${sighting.at} (event ${sighting.event.slice(0, 12)})`);
      evidence.push({ kind: "event", value: sighting.event, label: "seen live earlier" });
    }
  }
  if (notLive.length + failing.length > 0) {
    const absentUnseen = read.some((s) => s.status === "absent") && seen === null;
    if (absentUnseen) {
      gaps.push({
        item: "earlier sightings",
        reason: "no ledger was read, so a change that left production shows as not proven rather than not live"
      });
    }
    return {
      ...base,
      outcome: "fail",
      state: notLive.length > 0 ? "not_live" : "not_proven",
      examined,
      notExamined: gaps,
      evidence: dedupe(evidence),
      reasons: [...notLive, ...failing]
    };
  }
  if (unreadable.length > 0) {
    return {
      ...base,
      outcome: "examined_nothing",
      state: "not_proven",
      examined,
      notExamined: gaps,
      evidence: dedupe(evidence),
      reasons: [
        `${unreadable.length} of ${statuses.length} marker${statuses.length === 1 ? "" : "s"} could not be read`,
        ...unreadable.map((s) => `${s.gap.item}: ${s.gap.reason}`)
      ]
    };
  }
  return {
    ...base,
    outcome: "pass",
    state: "live",
    examined,
    notExamined: gaps,
    evidence: dedupe(evidence),
    reasons: read.map((s) => s.why)
  };
}
function summarize(input2, parts) {
  const n = parts.length;
  const runGaps = input2.notExamined ?? [];
  if (n === 0) {
    return {
      subject: input2.subject,
      outcome: "examined_nothing",
      examined: [{ item: "merged changes", count: 0 }],
      notExamined: runGaps,
      reasons: ["no merged changes were in scope, and a readback over no changes is not a pass"]
    };
  }
  const count3 = (state) => parts.filter((p) => p.state === state).length;
  const reasons = [`proven live ${count3("live")} of ${n} change${n === 1 ? "" : "s"}`];
  if (count3("not_live") > 0)
    reasons.push(`not live ${count3("not_live")}: seen live earlier, absent now`);
  if (count3("not_proven") > 0) {
    const failing = parts.filter((p) => p.state === "not_proven" && p.outcome === "fail").length;
    reasons.push(`not proven ${count3("not_proven")}: ${failing} absent or contradicted, ${count3("not_proven") - failing} could not be read`);
  }
  if (count3("nothing_to_prove") > 0) {
    reasons.push(`nothing to prove ${count3("nothing_to_prove")}, by their cards' claims, which a human has to accept`);
  }
  const evidence = [];
  for (const doc of input2.versions) {
    if (doc.status !== "ok")
      continue;
    const running = doc.commit ?? doc.reported;
    const match = input2.changes.find((c) => c.commit === doc.commit);
    reasons.push(`production at ${doc.url} runs ${short(running)}${match ? ` (${match.subject})` : ""}${doc.dirty ? " with uncommitted changes" : ""}`);
    evidence.push({ kind: "commit", value: running, label: `running at ${doc.url}` });
  }
  for (const b of input2.bundles) {
    if (b.status === "ok")
      evidence.push({ kind: "hash", value: b.digest, label: `${files(b.files)} served from ${b.url}` });
  }
  return {
    subject: input2.subject,
    outcome: combine(parts.map((p) => p.outcome)),
    examined: [{ item: "merged changes", count: n }],
    notExamined: [...runGaps, ...parts.flatMap((p) => (p.notExamined ?? []).map((g) => ({ ...g, item: `${p.subject}: ${g.item}` })))],
    evidence,
    reasons
  };
}
var readbackCheck = {
  name: "readback",
  version: 1,
  summary: "Proves whether production holds each merged change, by version ancestry and markers.",
  parseInput: parseReadbackInput,
  evaluate(input2) {
    const facts = new Facts(input2);
    const seen = input2.history === null ? null : latestSightings(input2.history);
    const parts = input2.changes.map((c) => evaluateChange(facts, c, seen));
    return [summarize(input2, parts), ...parts];
  }
};
function readbackSightings(input2, event) {
  const facts = new Facts(input2);
  const out = [];
  for (const change of input2.changes) {
    for (const m of change.markers) {
      if (m.kind === "none" || m.kind === "db_object")
        continue;
      const s = markerStatus(facts, change, m);
      if (s.status !== "present")
        continue;
      const at2 = m.kind === "bundle" ? facts.bundles.get(m.url)?.at : facts.versions.get(m.url)?.at;
      out.push({ change: change.commit, marker: markerKey(m), at: at2, event });
    }
  }
  return out;
}

// packages/core/dist/index.js
function defaultRegistry() {
  return new CheckRegistry().register(invariantCheck).register(readbackCheck);
}

// packages/adapters/dist/version.js
var VERSION_PATHS = ["/version.json", "/api/version", "/version"];
async function probe(url2, opts) {
  const r = await fetchLimited(url2, { ...opts, maxBytes: 64 * 1024, accept: "application/json" });
  if (!r.ok)
    return { ok: false, reason: r.reason };
  if (isHtml(r)) {
    return { ok: false, reason: "the response is a web page, not a version document (sites often answer unknown paths with their index page)" };
  }
  const reading = readVersionDoc(r.body.toString("utf8"));
  if (!reading.ok)
    return { ok: false, reason: reading.problem };
  const digest2 = createHash2("sha256").update(r.body).digest("hex");
  return reading.dirty === void 0 ? { ok: true, commit: reading.commit, digest: digest2 } : { ok: true, commit: reading.commit, dirty: reading.dirty, digest: digest2 };
}
async function observed(url2, at2, p, resolve3) {
  const obs = { url: url2, at: at2, status: "ok", reported: p.commit, digest: p.digest };
  const full = await resolve3(p.commit);
  if (full !== void 0)
    obs.commit = full;
  if (p.dirty !== void 0)
    obs.dirty = p.dirty;
  return obs;
}
async function observeVersion(url2, at2, resolve3, opts = {}) {
  const p = await probe(url2, opts);
  return p.ok ? observed(url2, at2, p, resolve3) : { url: url2, at: at2, status: "unreadable", reason: p.reason };
}
async function discoverVersion(origin, at2, resolve3, opts = {}) {
  const tried = [];
  for (const path of VERSION_PATHS) {
    const url2 = new URL(path, origin).href;
    const p = await probe(url2, opts);
    if (p.ok)
      return observed(url2, at2, p, resolve3);
    tried.push(`${path}: ${p.reason}`);
  }
  return {
    url: new URL(VERSION_PATHS[0], origin).href,
    at: at2,
    status: "unreadable",
    reason: `production serves no version document (${tried.join("; ")})`
  };
}

// packages/adapters/dist/bundle.js
import { createHash as createHash3 } from "node:crypto";
var TAG = /<(script|link)\b([^>]*)>/gi;
var ATTR = /([^\s"'=<>`/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
var SCRIPT_REF = /["'`]((?:\.{1,2}\/|\/)[^"'`\s<>()]*?\.(?:m?js|css))["'`]/g;
function attributes(text) {
  const out = /* @__PURE__ */ new Map();
  for (const m of text.matchAll(ATTR))
    out.set(m[1].toLowerCase(), (m[2] ?? m[3] ?? m[4] ?? "").replace(/&amp;/g, "&"));
  return out;
}
function pageRefs(html) {
  const refs = [];
  for (const m of html.matchAll(TAG)) {
    const attrs = attributes(m[2]);
    if (m[1].toLowerCase() === "script") {
      const src = attrs.get("src");
      if (src)
        refs.push(src);
      continue;
    }
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const as = (attrs.get("as") ?? "").toLowerCase();
    const href = attrs.get("href");
    if (href && (rel.includes("stylesheet") || rel.includes("modulepreload") || rel.includes("preload") && (as === "script" || as === "style"))) {
      refs.push(href);
    }
  }
  return refs;
}
function scriptRefs(js) {
  return [...js.matchAll(SCRIPT_REF)].map((m) => m[1]);
}
function resolveRef(ref, base) {
  try {
    const u = new URL(ref, base);
    u.hash = "";
    return u.protocol === "http:" || u.protocol === "https:" ? u : void 0;
  } catch {
    return void 0;
  }
}
var MAX_FILE_BYTES = 10 * 1024 * 1024;
var isStyleOrScript = (contentType, url2) => /javascript|ecmascript|text\/css/.test(contentType) || /\.(?:m?js|css)$/i.test(new URL(url2).pathname);
async function observeBundle(pageUrl, texts, at2, opts = {}) {
  const maxFiles = opts.maxFiles ?? 100;
  const maxTotalBytes = opts.maxTotalBytes ?? 25 * 1024 * 1024;
  const concurrency = opts.concurrency ?? 6;
  const searched = [...new Set(texts)].sort();
  const unreadable = (reason) => ({ url: pageUrl, at: at2, status: "unreadable", complete: false, files: 0, bytes: 0, searched, found: [], reason });
  const page = await fetchLimited(pageUrl, { ...opts, accept: "text/html,*/*" });
  if (!page.ok)
    return unreadable(page.reason);
  const origin = new URL(pageUrl).origin;
  const read = /* @__PURE__ */ new Map([[pageUrl, page.body]]);
  const seen = /* @__PURE__ */ new Set([pageUrl]);
  const failures = [];
  const otherOrigins = /* @__PURE__ */ new Set();
  let total = page.body.length;
  let capped = false;
  const enqueue = (refs, base, required, into) => {
    for (const ref of refs) {
      const u = resolveRef(ref, base);
      if (u === void 0)
        continue;
      if (u.origin !== origin) {
        if (required)
          otherOrigins.add(u.origin);
        continue;
      }
      if (seen.has(u.href))
        continue;
      seen.add(u.href);
      into.push({ url: u.href, required });
    }
  };
  let level = [];
  if (isHtml(page))
    enqueue(pageRefs(page.body.toString("utf8")), pageUrl, true, level);
  while (level.length > 0 && !capped) {
    level.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
    const room = maxFiles - read.size;
    if (level.length > room) {
      level = level.slice(0, room);
      capped = true;
    }
    const next = [];
    for (let i = 0; i < level.length; i += concurrency) {
      const batch = level.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((ref) => fetchLimited(ref.url, { ...opts, maxBytes: MAX_FILE_BYTES })));
      batch.forEach((ref, j) => {
        const r = results[j];
        const path = new URL(ref.url).pathname;
        if (!r.ok) {
          if (!ref.required && r.status === 404)
            return;
          failures.push(`${path}: ${r.reason}`);
          return;
        }
        if (!ref.required && (isHtml(r) || !isStyleOrScript(r.contentType, ref.url)))
          return;
        if (ref.required && isHtml(r) && /\.(?:m?js|css)$/i.test(path)) {
          failures.push(`${path}: the server answered with a web page instead of the file`);
          return;
        }
        if (total + r.body.length > maxTotalBytes) {
          capped = true;
          return;
        }
        read.set(ref.url, r.body);
        total += r.body.length;
        if (!/text\/css/.test(r.contentType))
          enqueue(scriptRefs(r.body.toString("utf8")), ref.url, false, next);
      });
    }
    level = next;
  }
  const found = searched.filter((text) => {
    const needle = Buffer.from(text, "utf8");
    for (const body of read.values())
      if (body.includes(needle))
        return true;
    return false;
  });
  const listing = [...read].map(([url2, body]) => [url2, createHash3("sha256").update(body).digest("hex")]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const obs = {
    url: pageUrl,
    at: at2,
    status: "ok",
    complete: failures.length === 0 && !capped,
    files: read.size,
    bytes: total,
    digest: createHash3("sha256").update(canonicalJson(listing)).digest("hex"),
    searched,
    found
  };
  if (otherOrigins.size > 0)
    obs.otherOrigins = [...otherOrigins].sort().slice(0, 20);
  const problems = [];
  if (failures.length > 0)
    problems.push(`${failures.length} referenced file${failures.length === 1 ? "" : "s"} could not be read (${failures.slice(0, 3).join("; ")})`);
  if (capped)
    problems.push(`the search stopped at its limit of ${maxFiles} files or ${maxTotalBytes} bytes`);
  if (problems.length > 0)
    obs.reason = problems.join("; ");
  return obs;
}

// packages/state/dist/store.js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// packages/state/dist/git.js
import { spawn } from "node:child_process";
var GitError = class extends Error {
  args;
  result;
  name = "GitError";
  constructor(args, result) {
    super(`git ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`);
    this.args = args;
    this.result = result;
  }
};
function runGit(args, opts) {
  return new Promise((resolve3, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...opts.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => resolve3({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }));
    child.stdin.on("error", () => void 0);
    child.stdin.end(opts.input ?? "");
  });
}
async function git(args, opts) {
  const result = await runGit(args, opts);
  if (result.code !== 0)
    throw new GitError(args, result);
  return result.stdout.toString("utf8").trim();
}

// packages/state/dist/store.js
var STATE_BRANCH = "seamkit/state";
var STATE_REF = `refs/heads/${STATE_BRANCH}`;
var STATE_IDENTITY = {
  GIT_AUTHOR_NAME: "seamkit",
  GIT_AUTHOR_EMAIL: "seamkit@localhost",
  GIT_COMMITTER_NAME: "seamkit",
  GIT_COMMITTER_EMAIL: "seamkit@localhost"
};
var README = `# seamkit state

This branch is written by seamkit and holds its ledger: one file per event under \`events/\`, named by
the event's time and the SHA-256 of its content. Files are only ever added. Nothing here is edited
by hand, and the branch is never merged into any other branch.

Check every file against its name with \`seamkit state verify\`.
`;
var NotAGitRepository = class extends Error {
  name = "NotAGitRepository";
};
var MAX_APPEND_ATTEMPTS = 25;
var MAX_SYNC_ATTEMPTS = 5;
function sleep(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
var GitStateStore = class _GitStateStore {
  cwd;
  constructor(cwd) {
    this.cwd = cwd;
  }
  static async open(cwd) {
    const inside = await runGit(["rev-parse", "--git-dir"], { cwd });
    if (inside.code !== 0)
      throw new NotAGitRepository(`not a git repository: ${cwd}`);
    return new _GitStateStore(cwd);
  }
  git(args, input2, env) {
    const opts = { cwd: this.cwd };
    if (input2 !== void 0)
      opts.input = input2;
    if (env !== void 0)
      opts.env = env;
    return git(args, opts);
  }
  /** The commit the state branch points to, or undefined when it does not exist yet. */
  async head() {
    const r = await runGit(["rev-parse", "--verify", "--quiet", `${STATE_REF}^{commit}`], { cwd: this.cwd });
    return r.code === 0 ? r.stdout.toString("utf8").trim() : void 0;
  }
  async exists() {
    return await this.head() !== void 0;
  }
  /** Creates the branch with only its README. Does nothing when it already exists. */
  async init() {
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const existing = await this.head();
      if (existing !== void 0)
        return { created: false, commit: existing };
      const blob = await this.git(["hash-object", "-w", "--stdin"], README);
      const tree = await this.treeWith(void 0, [{ path: "README.md", oid: blob }]);
      const commit2 = await this.commitTree(tree, [], "seamkit: create state branch");
      if (await this.casRef(commit2, void 0))
        return { created: true, commit: commit2 };
    }
    throw new Error("could not create the state branch");
  }
  /** Adds one event file. Retries when another writer moved the branch first. */
  async append(event) {
    const id = eventId(event);
    const path = eventPath(event.at, id);
    const blob = await this.git(["hash-object", "-w", "--stdin"], eventFileContent(event));
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const parent = await this.head();
      if (parent !== void 0) {
        const existing = await this.git(["ls-tree", parent, "--", path]);
        if (existing.length > 0)
          return { id, path, commit: parent, created: false };
      }
      const files2 = parent === void 0 ? [{ path: "README.md", oid: await this.git(["hash-object", "-w", "--stdin"], README) }] : [];
      files2.push({ path, oid: blob });
      const tree = await this.treeWith(parent, files2);
      const commit2 = await this.commitTree(tree, parent === void 0 ? [] : [parent], `seamkit: ${event.kind} ${id.slice(0, 12)}`);
      if (await this.casRef(commit2, parent))
        return { id, path, commit: commit2, created: true };
      await sleep(Math.floor(Math.random() * 20) + attempt * 5);
    }
    throw new Error(`could not append event ${id.slice(0, 12)} after ${MAX_APPEND_ATTEMPTS} attempts`);
  }
  /** Every event file on the branch, in path order (which is time order). */
  async list() {
    const head = await this.head();
    if (head === void 0)
      return [];
    return this.filesAt(head, "events");
  }
  /**
   * Merges the local branch with the remote's and pushes the result, never forcing. Because every
   * event file is named by its content, two writers can only ever add different paths, so the
   * merge is a union of files and cannot conflict.
   */
  async sync(remote = "origin") {
    const hasRemote = await runGit(["remote", "get-url", remote], { cwd: this.cwd });
    if (hasRemote.code !== 0)
      return { status: "no_remote", remote, attempts: 0 };
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt++) {
      const advertised = await this.git(["ls-remote", remote, STATE_REF]);
      const remoteHead = advertised.split("\n").map((line) => line.split("	")).find(([, ref]) => ref === STATE_REF)?.[0];
      if (remoteHead !== void 0) {
        await this.git(["fetch", "--quiet", "--no-tags", remote, `+${STATE_REF}:refs/remotes/${remote}/${STATE_BRANCH}`]);
      }
      const local = await this.head();
      if (local === void 0 && remoteHead === void 0)
        return { status: "empty", remote, attempts: attempt };
      if (local === void 0) {
        if (await this.casRef(remoteHead, void 0))
          return { status: "pulled", remote, local: remoteHead, attempts: attempt };
        continue;
      }
      if (remoteHead === local)
        return { status: "up_to_date", remote, local, attempts: attempt };
      if (remoteHead !== void 0 && await this.isAncestor(local, remoteHead)) {
        if (await this.casRef(remoteHead, local))
          return { status: "pulled", remote, local: remoteHead, attempts: attempt };
        continue;
      }
      let toPush = local;
      let status = "pushed";
      if (remoteHead !== void 0 && !await this.isAncestor(remoteHead, local)) {
        const merged = await this.mergeCommit(remoteHead, local);
        if (!await this.casRef(merged, local))
          continue;
        toPush = merged;
        status = "merged";
      }
      const pushed = await runGit(["push", "--quiet", remote, `${toPush}:${STATE_REF}`], { cwd: this.cwd });
      if (pushed.code === 0)
        return { status, remote, local: toPush, attempts: attempt };
      if (attempt === MAX_SYNC_ATTEMPTS)
        throw new GitError(["push", remote, STATE_REF], pushed);
      await new Promise((resolve3) => setTimeout(resolve3, attempt * 250 + Math.floor(Math.random() * 250)));
    }
    throw new Error(`could not synchronise ${STATE_BRANCH} with ${remote} after ${MAX_SYNC_ATTEMPTS} attempts`);
  }
  async isAncestor(ancestor, descendant) {
    const r = await runGit(["merge-base", "--is-ancestor", ancestor, descendant], { cwd: this.cwd });
    if (r.code === 0)
      return true;
    if (r.code === 1)
      return false;
    throw new GitError(["merge-base", "--is-ancestor", ancestor, descendant], r);
  }
  async mergeCommit(remoteHead, local) {
    const theirs = new Map((await this.entries(remoteHead)).map((e) => [e.path, e.oid]));
    const added = [];
    for (const e of await this.entries(local)) {
      const other = theirs.get(e.path);
      if (other === void 0)
        added.push(e);
      else if (other !== e.oid && e.path.startsWith("events/")) {
        throw new Error(`state branches disagree about ${e.path}; one copy has been altered, run seamkit state verify`);
      }
    }
    const tree = await this.treeWith(remoteHead, added);
    return this.commitTree(tree, [remoteHead, local], "seamkit: merge state");
  }
  async entries(commit2) {
    const out = await runGit(["ls-tree", "-r", "-z", "--full-tree", commit2], { cwd: this.cwd });
    if (out.code !== 0)
      throw new GitError(["ls-tree", commit2], out);
    return out.stdout.toString("utf8").split("\0").filter((line) => line.length > 0).map((line) => {
      const tab = line.indexOf("	");
      const [, , oid] = line.slice(0, tab).split(" ");
      return { path: line.slice(tab + 1), oid };
    });
  }
  async filesAt(commit2, prefix) {
    const entries = (await this.entries(commit2)).filter((e) => e.path.startsWith(`${prefix}/`));
    if (entries.length === 0)
      return [];
    const batch = await runGit(["cat-file", "--batch"], { cwd: this.cwd, input: entries.map((e) => e.oid).join("\n") + "\n" });
    if (batch.code !== 0)
      throw new GitError(["cat-file", "--batch"], batch);
    const buf = batch.stdout;
    const files2 = [];
    let offset = 0;
    for (const entry of entries) {
      const headerEnd = buf.indexOf(10, offset);
      const header = buf.subarray(offset, headerEnd).toString("utf8");
      const size = Number(header.split(" ")[2]);
      if (!Number.isInteger(size))
        throw new Error(`unexpected cat-file header: ${header}`);
      const start = headerEnd + 1;
      files2.push({ path: entry.path, oid: entry.oid, content: buf.subarray(start, start + size).toString("utf8") });
      offset = start + size + 1;
    }
    return files2.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  /** Writes a tree equal to `parent`'s tree plus `files`, using a private index file. */
  async treeWith(parent, files2) {
    const dir = await mkdtemp(join(tmpdir(), "seamkit-index-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    try {
      await this.git(parent === void 0 ? ["read-tree", "--empty"] : ["read-tree", parent], void 0, env);
      if (files2.length > 0) {
        const info = files2.map((f) => `100644 ${f.oid}	${f.path}`).join("\n") + "\n";
        await this.git(["update-index", "--add", "--index-info"], info, env);
      }
      return await this.git(["write-tree"], void 0, env);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  commitTree(tree, parents, message) {
    const args = ["commit-tree", "--no-gpg-sign", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message];
    return this.git(args, void 0, STATE_IDENTITY);
  }
  /** Moves the branch from `expected` (undefined: must not exist) to `next`, or reports that it lost a race. */
  async casRef(next, expected) {
    const r = await runGit(["update-ref", STATE_REF, next, expected ?? ""], { cwd: this.cwd });
    return r.code === 0;
  }
};

// packages/adapters/dist/git.js
var HEX = /^[0-9a-f]{4,64}$/;
async function isBranchName(cwd, name) {
  if (name === "" || name.startsWith("-"))
    return false;
  const r = await runGit(["check-ref-format", "--branch", name], { cwd });
  return r.code === 0 && r.stdout.toString("utf8").trim() === name;
}
var GitRepo = class _GitRepo {
  cwd;
  constructor(cwd) {
    this.cwd = cwd;
  }
  static async open(cwd) {
    const r = await runGit(["rev-parse", "--show-toplevel"], { cwd });
    if (r.code !== 0)
      throw new NotAGitRepository(cwd);
    return new _GitRepo(r.stdout.toString("utf8").trim());
  }
  async rev(name) {
    const r = await runGit(["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd: this.cwd });
    return r.code === 0 ? r.stdout.toString("utf8").trim() : void 0;
  }
  /**
   * The branch changes are merged into: the one named, else the remote's default branch, else
   * main or master, else whatever is checked out. The remote-tracking branch is preferred,
   * because it is what was merged as of the last fetch.
   */
  async resolveBranch(name) {
    if (name !== void 0) {
      if (name.startsWith("-"))
        throw new Error(`there is no branch or commit called ${name}`);
      const remote = !name.startsWith("refs/") && await isBranchName(this.cwd, name) ? await this.rev(`refs/remotes/origin/${name}`) : void 0;
      if (remote !== void 0)
        return { name, head: remote };
      const head2 = await this.rev(name);
      if (head2 === void 0)
        throw new Error(`there is no branch or commit called ${name}`);
      return { name, head: head2 };
    }
    const originHead = await runGit(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], { cwd: this.cwd });
    const candidates = [
      ...originHead.code === 0 ? [originHead.stdout.toString("utf8").trim()] : [],
      "refs/remotes/origin/main",
      "refs/remotes/origin/master",
      "refs/heads/main",
      "refs/heads/master"
    ];
    for (const ref of candidates) {
      const head2 = await this.rev(ref);
      if (head2 !== void 0)
        return { name: ref.replace(/^refs\/(?:remotes|heads)\//, ""), head: head2 };
    }
    const head = await this.rev("HEAD");
    if (head === void 0)
      throw new Error("the repository has no commits yet");
    const branch = await runGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: this.cwd });
    return { name: branch.code === 0 ? branch.stdout.toString("utf8").trim() : "HEAD", head };
  }
  /** The newest `limit` commits on the first-parent line of `head`, newest first. */
  async firstParent(head, limit) {
    if (limit <= 0)
      return [];
    const list2 = await git(["rev-list", "--first-parent", `--max-count=${limit}`, head], { cwd: this.cwd });
    return this.read(list2.split("\n").filter((l) => l.length > 0));
  }
  async commit(rev) {
    const full = rev.startsWith("-") ? void 0 : await this.rev(rev);
    return full === void 0 ? void 0 : (await this.read([full]))[0];
  }
  /** How many commits on the first-parent line of `head` are not reachable from `exclude`. */
  async countFirstParent(head, exclude) {
    return Number(await git(["rev-list", "--first-parent", "--count", head, `^${exclude}`], { cwd: this.cwd }));
  }
  /**
   * The full ids of many abbreviated commits in one git process, in order: undefined for one that
   * is missing, ambiguous or not a commit.
   */
  async resolveAll(abbrevs) {
    const asked = abbrevs.filter((a) => HEX.test(a));
    if (asked.length === 0)
      return abbrevs.map(() => void 0);
    const r = await runGit(["cat-file", `--batch-check=%(objectname) %(objecttype)`], { cwd: this.cwd, input: asked.map((a) => `${a}^{commit}
`).join("") });
    if (r.code !== 0)
      throw new GitError(["cat-file", "--batch-check"], r);
    const answers = r.stdout.toString("utf8").split("\n");
    const found = /* @__PURE__ */ new Map();
    asked.forEach((a, i) => {
      const [id, type] = (answers[i] ?? "").split(" ");
      if (type === "commit" && id !== void 0 && /^[0-9a-f]{40,64}$/.test(id))
        found.set(a, id);
    });
    return abbrevs.map((a) => found.get(a));
  }
  /** The full id of an abbreviated commit, or undefined when it is missing or ambiguous. */
  async resolve(abbrev) {
    return HEX.test(abbrev) ? this.rev(abbrev) : void 0;
  }
  /** Whether `running` contains `change`; null, with git's reason, when git cannot tell. */
  async contains(running, change) {
    const r = await runGit(["merge-base", "--is-ancestor", change, running], { cwd: this.cwd });
    if (r.code === 0)
      return { contains: true };
    if (r.code === 1)
      return { contains: false };
    return { contains: null, reason: `git could not compare the commits: ${r.stderr.trim().split("\n")[0] ?? `exit ${r.code}`}` };
  }
  /** The commits reachable from any of `tips`, full ids, and not from `exclude`. */
  async reachableFrom(tips, exclude) {
    if (tips.length === 0)
      return /* @__PURE__ */ new Set();
    const r = await runGit(["rev-list", "--stdin"], { cwd: this.cwd, input: `${[...tips, `^${exclude}`].join("\n")}
` });
    if (r.code !== 0)
      throw new GitError(["rev-list", "--stdin"], r);
    return new Set(r.stdout.toString("utf8").split("\n").filter((l) => l.length > 0));
  }
  async isShallow() {
    return await git(["rev-parse", "--is-shallow-repository"], { cwd: this.cwd }) === "true";
  }
  async read(ids) {
    if (ids.length === 0)
      return [];
    const batch = await runGit(["cat-file", "--batch"], { cwd: this.cwd, input: `${ids.join("\n")}
` });
    if (batch.code !== 0)
      throw new GitError(["cat-file", "--batch"], batch);
    const buf = batch.stdout;
    const out = [];
    let offset = 0;
    for (const id of ids) {
      const headerEnd = buf.indexOf(10, offset);
      const [oid, type, size] = buf.subarray(offset, headerEnd).toString("utf8").split(" ");
      if (oid !== id || type !== "commit" || !Number.isInteger(Number(size)))
        throw new Error(`cannot read commit ${id}`);
      const start = headerEnd + 1;
      const raw = buf.subarray(start, start + Number(size)).toString("utf8");
      offset = start + Number(size) + 1;
      const split = raw.indexOf("\n\n");
      const headers = (split === -1 ? raw : raw.slice(0, split)).split("\n");
      out.push({
        commit: id,
        parents: headers.filter((h) => h.startsWith("parent ")).map((h) => h.slice("parent ".length)),
        message: split === -1 ? "" : raw.slice(split + 2)
      });
    }
    return out;
  }
};

// packages/cli/dist/cli.js
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve as resolve2 } from "node:path";
import { parseArgs } from "node:util";

// packages/formats/dist/card.js
var import_yaml = __toESM(require_dist(), 1);
var LAYERS = ["frontend", "function", "schema", "data", "config"];
var RISKS = ["ship_alone", "stop_for_human"];
var MARKER_KINDS = ["bundle", "version", "db_object", "none"];
var FIELDS = ["card", "intent", "layers", "targets", "markers", "releaseNote", "risk"];
var MAX_CARD_BYTES = 16 * 1024;
var MIN_MARKER_TEXT2 = 4;
function extractCardBlocks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let open;
  for (const line of lines) {
    if (open === void 0) {
      const m = /^( {0,3})(`{3,}|~{3,})[ \t]*seamkit-card[ \t]*$/.exec(line);
      if (m)
        open = { char: m[2][0], length: m[2].length, indent: m[1].length, body: [] };
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (close && close[1][0] === open.char && close[1].length >= open.length) {
      blocks.push(open.body.join("\n"));
      open = void 0;
      continue;
    }
    open.body.push(line.replace(new RegExp(`^ {0,${open.indent}}`), ""));
  }
  return { blocks, unclosed: open !== void 0 };
}
function readCard(text) {
  const { blocks, unclosed } = extractCardBlocks(text);
  if (blocks.length === 0 && !unclosed)
    return { found: false };
  if (unclosed)
    return { found: true, ok: false, problems: ["the seamkit-card block is never closed; end it with a line of three backticks"] };
  if (blocks.length > 1)
    return { found: true, ok: false, problems: [`there are ${blocks.length} seamkit-card blocks; a change has exactly one`] };
  return { found: true, ...parseCard(blocks[0]) };
}
var keyName = (k) => /^[A-Za-z0-9_.-]{1,64}$/.test(k) ? k : JSON.stringify(k);
var describe = (v) => v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "a mapping" : JSON.stringify(v);
function parseCard(yamlText) {
  if (Buffer.byteLength(yamlText, "utf8") > MAX_CARD_BYTES)
    return { ok: false, problems: [`the card is larger than ${MAX_CARD_BYTES / 1024} KiB`] };
  const doc = (0, import_yaml.parseDocument)(yamlText, { version: "1.2", schema: "core", uniqueKeys: true, strict: true, logLevel: "error" });
  const yamlProblems = [...doc.errors, ...doc.warnings].map((e) => `the card is not valid YAML: ${e.message.split("\n")[0].replace(/:$/, "")}`);
  if (yamlProblems.length > 0)
    return { ok: false, problems: yamlProblems };
  let raw;
  try {
    raw = doc.toJS({ maxAliasCount: 0 });
  } catch (err) {
    return { ok: false, problems: [`the card is not valid YAML: ${err.message.split("\n")[0]}`] };
  }
  const problems = [];
  const card = checkCard(raw, problems);
  return problems.length > 0 || card === void 0 ? { ok: false, problems } : { ok: true, card };
}
function str(value, field2, problems, required) {
  if (value === void 0) {
    problems.push(`${field2} is required: ${required}`);
    return void 0;
  }
  if (typeof value !== "string") {
    problems.push(typeof value === "number" || typeof value === "boolean" ? `${field2} must be a string; quote it, for example ${field2.split(".").pop()}: "${String(value)}"` : `${field2} must be a string, got ${describe(value)}`);
    return void 0;
  }
  if (value.trim().length === 0) {
    problems.push(`${field2} must not be empty: ${required}`);
    return void 0;
  }
  return value;
}
function url(value, field2, problems) {
  if (value === void 0)
    return void 0;
  const text = str(value, field2, problems, "an absolute http or https URL, or a path such as /version.json");
  if (text === void 0)
    return void 0;
  if (/^\/(?!\/)[^\s?#]*$/.test(text))
    return text;
  try {
    const u = new URL(text);
    if ((u.protocol === "http:" || u.protocol === "https:") && u.username === "" && u.password === "")
      return text;
  } catch {
  }
  problems.push(`${field2} must be a path such as /version.json, or an absolute http or https URL without a user name or password`);
  return void 0;
}
function list(value, field2, problems, hint) {
  if (value === void 0) {
    problems.push(`${field2} is required: ${hint}`);
    return void 0;
  }
  if (!Array.isArray(value)) {
    problems.push(`${field2} must be a list, got ${describe(value)}: ${hint}`);
    return void 0;
  }
  return value;
}
function checkMarker(raw, field2, problems) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    problems.push(`${field2} must be a mapping with a kind, such as - kind: bundle`);
    return void 0;
  }
  const m = raw;
  const kind = m["kind"];
  if (typeof kind !== "string" || !MARKER_KINDS.includes(kind)) {
    problems.push(`${field2}.kind must be one of ${MARKER_KINDS.join(", ")}; got ${describe(kind)}`);
    return void 0;
  }
  const allowed = {
    bundle: ["kind", "text", "url"],
    version: ["kind", "url"],
    db_object: ["kind", "object"],
    none: ["kind", "reason"]
  };
  const extra = Object.keys(m).filter((k) => !allowed[kind].includes(k));
  if (extra.length > 0)
    problems.push(`${field2} has unknown field(s) for kind ${kind}: ${extra.map(keyName).join(", ")}; allowed: ${allowed[kind].join(", ")}`);
  switch (kind) {
    case "bundle": {
      const text = str(m["text"], `${field2}.text`, problems, "text the built output contains, not text that exists only in source");
      if (text !== void 0 && text.trim().length < MIN_MARKER_TEXT2) {
        problems.push(`${field2}.text must be at least ${MIN_MARKER_TEXT2} characters, so that only this change adds it`);
      } else if (text !== void 0 && text.length > 200) {
        problems.push(`${field2}.text must be at most 200 characters`);
      }
      const u = url(m["url"], `${field2}.url`, problems);
      if (text === void 0)
        return void 0;
      return u === void 0 ? { kind, text } : { kind, text, url: u };
    }
    case "version": {
      const u = url(m["url"], `${field2}.url`, problems);
      return u === void 0 ? { kind } : { kind, url: u };
    }
    case "db_object": {
      const object2 = str(m["object"], `${field2}.object`, problems, "the database object whose presence proves the change, such as schema.table");
      return object2 === void 0 ? void 0 : { kind, object: object2 };
    }
    default: {
      const reason = str(m["reason"], `${field2}.reason`, problems, 'why this change has nothing to prove in production, such as "tests only"');
      return reason === void 0 ? void 0 : { kind: "none", reason };
    }
  }
}
function checkCard(raw, problems) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    problems.push("the card must be a YAML mapping of fields, starting with card: 1");
    return void 0;
  }
  const c = raw;
  const unknown = Object.keys(c).filter((k) => !FIELDS.includes(k));
  if (unknown.length > 0)
    problems.push(`card has unknown field(s): ${unknown.map(keyName).join(", ")}; allowed: ${FIELDS.join(", ")}`);
  if (c["card"] !== 1)
    problems.push(`card must be 1, the card format version; got ${describe(c["card"])}`);
  const intent = str(c["intent"], "intent", problems, "one sentence saying what the change does and why");
  const layers = [];
  const rawLayers = list(c["layers"], "layers", problems, `drawn from ${LAYERS.join(", ")}; use [] when nothing deployed changes`);
  rawLayers?.forEach((l, i) => {
    if (typeof l !== "string" || !LAYERS.includes(l))
      problems.push(`layers[${i}] must be one of ${LAYERS.join(", ")}; got ${describe(l)}`);
    else if (layers.includes(l))
      problems.push(`layers lists ${l} twice`);
    else
      layers.push(l);
  });
  const targets = [];
  const rawTargets = list(c["targets"], "targets", problems, "what the change deploys, such as web or fn:notes-sync; use [] when nothing deployed changes");
  rawTargets?.forEach((t, i) => {
    const s = str(t, `targets[${i}]`, problems, "a target name");
    if (s !== void 0)
      targets.push(s);
  });
  const markers = [];
  const rawMarkers = list(c["markers"], "markers", problems, "how readback proves the change live; use - kind: none with a reason when there is nothing to prove");
  if (rawMarkers !== void 0 && rawMarkers.length === 0) {
    problems.push("markers must list at least one marker; use - kind: none with a reason when there is nothing to prove");
  }
  rawMarkers?.forEach((m, i) => {
    const marker = checkMarker(m, `markers[${i}]`, problems);
    if (marker !== void 0)
      markers.push(marker);
  });
  if (markers.some((m) => m.kind === "none") && (rawMarkers?.length ?? 0) > 1) {
    problems.push("markers: a none marker must be the only marker, since a change either has something to prove or does not");
  }
  const keys = markers.map((m) => JSON.stringify(m));
  if (new Set(keys).size !== keys.length)
    problems.push("markers lists the same marker twice");
  let releaseNote;
  if (c["releaseNote"] !== void 0)
    releaseNote = str(c["releaseNote"], "releaseNote", problems, "one sentence for the people who use the product");
  let risk;
  if (c["risk"] !== void 0) {
    if (typeof c["risk"] === "string" && RISKS.includes(c["risk"]))
      risk = c["risk"];
    else
      problems.push(`risk must be one of ${RISKS.join(", ")}; got ${describe(c["risk"])}`);
  }
  if (problems.length > 0 || intent === void 0)
    return void 0;
  const card = { card: 1, intent, layers, targets, markers };
  if (releaseNote !== void 0)
    card.releaseNote = releaseNote;
  if (risk !== void 0)
    card.risk = risk;
  return card;
}

// packages/formats/dist/commit-message.js
var MERGE_PR = /^Merge pull request #(\d+) from (\S+)/;
var TITLED_PR = /^(.*\S)\s+\(#(\d+)\)$/;
function parseChangeMessage(message, parentCount) {
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  const subject = (lines[0] ?? "").trim();
  const firstBodyLine = lines.slice(1).map((l) => l.trim()).find((l) => l.length > 0);
  const merge = parentCount >= 2;
  if (merge) {
    const m = MERGE_PR.exec(subject);
    if (m)
      return { kind: "pull_request", pr: Number(m[1]), title: firstBodyLine ?? m[2] };
  }
  const titled = TITLED_PR.exec(subject);
  if (titled)
    return { kind: "pull_request", pr: Number(titled[2]), title: titled[1] };
  return { kind: merge ? "merge" : "commit", title: subject || "(no message)" };
}

// packages/cli/dist/readback.js
var PR_SEARCH_DEPTH = 200;
var short2 = (commit2) => commit2.slice(0, 12);
var COMMIT_ID = /^[0-9a-f]{4,64}$/;
function subjectOf(c, pr) {
  return pr === void 0 ? `commit:${short2(c.commit)}` : `pr#${pr}`;
}
function toChange(c, pageUrl, primary, subjects) {
  const message = parseChangeMessage(c.message, c.parents.length);
  let subject = subjectOf(c, message.pr);
  if (subjects.has(subject))
    subject = `commit:${short2(c.commit)}`;
  subjects.add(subject);
  const implicit = [{ kind: "version", url: primary.url }];
  const card = readCard(c.message);
  if (!card.found)
    return { subject, commit: c.commit, title: message.title, markerSource: "implicit", markers: implicit, cardFound: false };
  if (!card.ok) {
    return { subject, commit: c.commit, title: message.title, markerSource: "implicit", markers: implicit, cardProblems: card.problems.slice(0, 20), cardFound: true };
  }
  const at2 = (u, fallback) => u === void 0 ? fallback : new URL(u, pageUrl).href;
  const markers = card.card.markers.map((m) => {
    switch (m.kind) {
      case "bundle":
        return { kind: "bundle", url: at2(m.url, pageUrl), text: m.text };
      case "version":
        return { kind: "version", url: at2(m.url, primary.url) };
      default:
        return m;
    }
  });
  const unique2 = markers.filter((m, i) => markers.findIndex((o) => JSON.stringify(o) === JSON.stringify(m)) === i);
  return { subject, commit: c.commit, title: message.title, markerSource: "card", markers: unique2, cardFound: true };
}
async function loadHistory(cwd, primaryUrl, addresses, commits) {
  let store;
  try {
    store = await GitStateStore.open(cwd);
  } catch (err) {
    if (err instanceof NotAGitRepository)
      return null;
    throw err;
  }
  if (!await store.exists())
    return null;
  const latest = /* @__PURE__ */ new Map();
  let readHere = false;
  const observed2 = /* @__PURE__ */ new Set();
  for (const file of await store.list()) {
    const parsed = parseEventFile(file.path, file.content);
    if (!parsed.ok || parsed.kind !== "verdict")
      continue;
    const run2 = parsed.event["body"].run;
    if (run2.record.check !== readbackCheck.name || run2.record.version !== readbackCheck.version)
      continue;
    let input2;
    try {
      input2 = readbackCheck.parseInput(run2.record.input);
    } catch {
      continue;
    }
    const first = input2.versions[0];
    if (first !== void 0 && addresses.has(first.url) && first.status === "ok") {
      if (first.url === primaryUrl)
        readHere = true;
      const named = first.commit ?? first.reported;
      if (named !== void 0 && COMMIT_ID.test(named))
        observed2.add(named);
    }
    for (const s of readbackSightings(input2, parsed.id)) {
      if (!commits.has(s.change))
        continue;
      const key = `${s.change} ${s.marker}`;
      const prev = latest.get(key);
      if (prev === void 0 || s.at > prev.at || s.at === prev.at && s.event > prev.event)
        latest.set(key, s);
    }
  }
  return { sightings: [...latest.values()].sort((a, b) => a.change + a.marker < b.change + b.marker ? -1 : 1), readHere, observed: [...observed2].sort() };
}
async function gatherReadback(cwd, req, now, http) {
  const repo = await GitRepo.open(cwd);
  const branch = await repo.resolveBranch(req.branch);
  const resolve3 = (reported) => repo.resolve(reported);
  const origin = new URL(req.url).origin;
  const primary = req.versionUrl !== void 0 ? await observeVersion(req.versionUrl, now(), resolve3, http) : await discoverVersion(origin, now(), resolve3, http);
  const runGaps = [];
  let deployed;
  if (req.deployed !== void 0) {
    const d = await repo.commit(req.deployed);
    if (d === void 0)
      throw new Error(`there is no commit called ${req.deployed} in this repository; fetch it, or check the --deployed value`);
    deployed = d.commit;
  }
  let commits;
  let subject;
  let window;
  if (req.commit !== void 0) {
    const c = await repo.commit(req.commit);
    if (c === void 0)
      throw new Error(`there is no commit called ${req.commit} in this repository`);
    commits = [c];
    subject = `commit:${short2(c.commit)}`;
  } else {
    const after = deployed !== void 0 && req.pr === void 0 ? await repo.countFirstParent(branch.head, deployed) : 0;
    const depth = req.pr !== void 0 ? Math.max(req.last, PR_SEARCH_DEPTH) : req.last + after;
    const history2 = await repo.firstParent(branch.head, req.pr === void 0 ? depth + 1 : depth);
    if (req.pr === void 0) {
      commits = history2.slice(0, depth);
      subject = branch.name;
      window = { more: history2.length > depth };
    } else {
      commits = history2.filter((c) => parseChangeMessage(c.message, c.parents.length).pr === req.pr).slice(0, 1);
      subject = `pr#${req.pr}`;
      if (commits.length === 0) {
        runGaps.push({
          item: `pr#${req.pr}`,
          reason: `not among the last ${history2.length} changes on ${branch.name}; it may not be merged yet, or it is older (raise --last)`
        });
      }
    }
  }
  const shallow = await repo.isShallow();
  if (shallow)
    runGaps.push({ item: "history beyond the shallow clone", reason: "the clone is shallow; run git fetch --unshallow to examine older changes" });
  const subjects = /* @__PURE__ */ new Set();
  let drafts = commits.map((c) => toChange(c, req.url, primary, subjects));
  const addresses = new Set(req.versionUrl !== void 0 ? [primary.url] : VERSION_PATHS.map((p) => new URL(p, origin).href));
  const loaded = await loadHistory(cwd, primary.url, addresses, new Set(drafts.map((c) => c.commit)));
  const history = loaded === null ? null : loaded.sightings;
  if (deployed !== void 0) {
    const ran = [];
    const missing = [];
    if (loaded !== null && loaded.readHere) {
      const now2 = primary.status === "ok" ? primary.commit ?? primary.reported : void 0;
      const named = [.../* @__PURE__ */ new Set([...loaded.observed, ...now2 !== void 0 && COMMIT_ID.test(now2) ? [now2] : []])];
      const full = await repo.resolveAll(named);
      named.forEach((n, i) => {
        const id = full[i];
        if (id === void 0)
          missing.push(n);
        else
          ran.push(id);
      });
    }
    if (loaded === null || !loaded.readHere || missing.length > 0) {
      const because = loaded === null ? "no ledger was read, so" : !loaded.readHere ? "the ledger holds no earlier run that read this address, so" : `production at this address was seen running ${missing.map(short2).join(", ")}, which this repository does not have (fetch the branch it came from), so`;
      runGaps.push({
        item: "whether changes merged after the deployed commit are still on their way",
        reason: `${because} one still on its way cannot be told from one a rollback removed; every change is judged${loaded === null ? " (keep a ledger with seamkit state init)" : ""}`
      });
    } else {
      const seen = new Set(loaded.sightings.map((s) => `${s.change} ${s.marker}`));
      const wasRunning = await repo.reachableFrom(ran, deployed);
      const afterDeploy = await repo.reachableFrom([branch.head], deployed);
      const kept2 = [];
      const later = [];
      for (const d of drafts) {
        const seenHere = d.markers.some((m) => seen.has(`${d.commit} ${markerKey(m)}`));
        if (!afterDeploy.has(d.commit) || seenHere || wasRunning.has(d.commit))
          kept2.push(d);
        else
          later.push(d.subject);
      }
      if (later.length > 0) {
        const listed = later.length > 20 ? `${later.slice(0, 20).join(", ")} and ${later.length - 20} more` : later.join(", ");
        const them = later.length === 1 ? "it" : "them";
        runGaps.push({
          item: `${later.length} change${later.length === 1 ? "" : "s"} merged after the deployed commit ${short2(deployed)}`,
          reason: `production at this address was never seen running ${them}, so the next deploy proves ${them}: ${listed}`
        });
      }
      drafts = kept2;
    }
  }
  if (window !== void 0) {
    if (drafts.length > req.last || window.more)
      runGaps.push({ item: `changes before the last ${req.last} on ${branch.name}`, reason: "outside --last" });
    drafts = drafts.slice(0, req.last);
  }
  const changes = drafts.map(({ cardFound: _, ...change }) => change);
  const versions = [primary];
  const markerUrls = new Set(changes.flatMap((c) => c.markers.flatMap((m) => m.kind === "version" ? [m.url] : [])));
  for (const url2 of [...markerUrls].sort()) {
    if (url2 !== primary.url)
      versions.push(await observeVersion(url2, now(), resolve3, http));
  }
  const texts = /* @__PURE__ */ new Map();
  for (const m of changes.flatMap((c) => c.markers)) {
    if (m.kind !== "bundle")
      continue;
    const set = texts.get(m.url) ?? /* @__PURE__ */ new Set();
    set.add(m.text);
    texts.set(m.url, set);
  }
  const bundles = [];
  for (const [url2, set] of [...texts].sort(([a], [b]) => a < b ? -1 : 1)) {
    const obs = await observeBundle(url2, [...set], now(), http);
    const sameOrigin = versions.filter((v) => new URL(v.url).origin === new URL(url2).origin);
    const context = sameOrigin.find((v) => v === primary) ?? sameOrigin[0];
    if (context !== void 0)
      obs.versionUrl = context.url;
    bundles.push(obs);
  }
  const ancestry = [];
  const running = [...new Set(versions.flatMap((v) => v.status === "ok" && v.commit !== void 0 ? [v.commit] : []))];
  for (const r of running) {
    for (const c of changes) {
      const answer = await repo.contains(r, c.commit);
      ancestry.push(answer.reason === void 0 ? { change: c.commit, running: r, contains: answer.contains } : { change: c.commit, running: r, contains: answer.contains, reason: answer.reason });
    }
  }
  const kept = new Set(changes.map((c) => c.commit));
  const input2 = { subject, changes, versions, ancestry, bundles, history: history === null ? null : history.filter((s) => kept.has(s.change)) };
  if (runGaps.length > 0)
    input2.notExamined = runGaps;
  return {
    input: input2,
    context: {
      branch: branch.name,
      primaryVersion: primary,
      shallow,
      ledger: history !== null,
      cards: { found: drafts.filter((d) => d.cardFound).length, broken: drafts.filter((d) => d.cardProblems !== void 0).length }
    }
  };
}
function auditAdvice(context) {
  const out = [];
  const v = context.primaryVersion;
  if (v.status === "unreadable") {
    out.push(`Production does not say which version it runs (${v.reason ?? "unreadable"}). Serve a version document: run "seamkit stamp --out <your public directory>/version.json" before the build, or answer /api/version with {"commit": "<full commit id>"}.`);
  } else if (v.commit === void 0) {
    out.push(`Production reports ${v.reported ?? "?"}, which this clone does not have. Run git fetch; if it is still missing, the build was made from a commit that was never pushed.`);
  } else if (v.dirty === true) {
    out.push(`Production's build of ${short2(v.commit)} was made with uncommitted changes, so its version proves nothing. Deploy from a clean commit.`);
  }
  if (context.shallow)
    out.push("This clone is shallow. Run git fetch --unshallow so older changes can be examined.");
  if (!context.ledger) {
    out.push('There is no ledger yet. Run "seamkit state init" so that later runs can tell a change that left production (not live) from one that never arrived (not proven).');
  }
  if (context.cards.broken > 0) {
    out.push(`${context.cards.broken} change${context.cards.broken === 1 ? " has a card" : "s have cards"} that cannot be used; each is listed above with its problems.`);
  }
  if (context.cards.found === 0) {
    out.push('No change carries a seamkit-card, so changes are proven by version alone. A card in a pull request description lets the change name text that production must serve, and it reaches the history only when the default commit message for merges is "Pull request title and description" (on GitHub: Settings, General, Pull Requests, for merge commits and squash merging alike).');
  }
  return out;
}

// packages/cli/dist/stamp.js
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
var STAMP_ENV_VARS = [
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "CF_PAGES_COMMIT_SHA",
  "COMMIT_REF",
  "RENDER_GIT_COMMIT",
  "CI_COMMIT_SHA",
  "BITBUCKET_COMMIT",
  "SOURCE_VERSION"
];
var StampError = class extends Error {
  name = "StampError";
};
async function gitText(args, cwd) {
  const r = await runGit(args, { cwd });
  return r.code === 0 ? r.stdout.toString("utf8").trim() : void 0;
}
async function uncommitted(top, outPath) {
  const r = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: top });
  if (r.code !== 0)
    throw new StampError(`git status failed: ${r.stderr.trim()}`);
  const tokens = r.stdout.toString("utf8").split("\0");
  const paths = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4)
      continue;
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (xy.includes("R") || xy.includes("C"))
      i++;
  }
  const own = outPath === void 0 ? void 0 : relative(top, outPath).split("\\").join("/");
  return paths.filter((p) => p !== own);
}
async function makeStamp(cwd, req, env, builtAt) {
  const outPath = req.out === void 0 ? void 0 : resolve(cwd, req.out);
  const top = await gitText(["rev-parse", "--show-toplevel"], cwd);
  if (req.commit !== void 0) {
    let full;
    if (req.commit.startsWith("-"))
      full = void 0;
    else if (top !== void 0)
      full = await gitText(["rev-parse", "--verify", "--quiet", `${req.commit}^{commit}`], top);
    else if (COMMIT_PATTERN.test(req.commit.toLowerCase()))
      full = req.commit.toLowerCase();
    if (full === void 0)
      throw new StampError(`--commit ${req.commit} does not name a commit${top === void 0 ? "; outside a repository give the full commit id" : ""}`);
    return { doc: { schema: VERSION_DOC_SCHEMA, commit: full, source: "argument", builtAt }, uncommitted: [] };
  }
  if (top !== void 0) {
    const head = await gitText(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], top);
    if (head !== void 0) {
      const changed = await uncommitted(top, outPath);
      const doc = { schema: VERSION_DOC_SCHEMA, commit: head, dirty: changed.length > 0, source: "git", builtAt };
      const ref = await gitText(["symbolic-ref", "--short", "-q", "HEAD"], top);
      if (ref)
        doc.ref = ref;
      return { doc, uncommitted: changed };
    }
  }
  for (const name of STAMP_ENV_VARS) {
    const value = env[name]?.trim().toLowerCase();
    if (value !== void 0 && COMMIT_PATTERN.test(value)) {
      return { doc: { schema: VERSION_DOC_SCHEMA, commit: value, source: `env:${name}`, builtAt }, uncommitted: [] };
    }
  }
  throw new StampError(`cannot tell which commit this build is from: run stamp inside the repository, pass --commit, or set one of ${STAMP_ENV_VARS.join(", ")}`);
}
async function writeStamp(cwd, out, doc) {
  const path = resolve(cwd, out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, versionDocText(doc));
  return path;
}

// packages/cli/dist/cli.js
var VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
var HELP = `seamkit ${VERSION}: deterministic production checks.

Usage:
  seamkit audit --url <production-url> [--last <n>] [--branch <ref>] [--json]
  seamkit readback --url <production-url> [--pr <n> | --commit <rev>] [--last <n>]
                   [--branch <ref>] [--deployed <rev>] [--version-url <url>]
                   [--record|--no-record] [--json]
  seamkit stamp [--out <file>] [--commit <rev>] [--require-clean]
  seamkit check <name> [--input <file>|-] [--record|--no-record] [--json]
  seamkit checks
  seamkit replay [<event-id-prefix>] [--json]
  seamkit state init
  seamkit state list [--json]
  seamkit state verify [--json]
  seamkit state sync [--remote <name>]
  seamkit version

readback proves whether production holds each merged change: by the commit production says it
runs (a version document, which "seamkit stamp" writes at build time), and by the markers in a
change's seamkit-card. audit is readback over the last changes with advice for every gap. The
production URL can also come from SEAMKIT_URL. After a deploy, --deployed names the commit just
deployed. When the ledger holds a run that read this address, a change merged after it that was
never seen live here, nor in any build production was seen running here, is left to the next
deploy; any other is still judged, so a rollback fails. Without such a run, or once production here
was seen running a commit this repository does not have, every change is judged. --last counts
the changes judged.

Every command that produces a verdict exits with its outcome:
  0 pass   1 fail   3 examined nothing   4 unclassified (stops for a human)
  2 usage or configuration error (no verdict was produced)

Verdicts are recorded on the ${STATE_BRANCH} branch when it exists (create it with
"seamkit state init"), or always with --record. Nothing else in the repository is touched.
`;
var UsageError = class extends Error {
  name = "UsageError";
};
async function run(argv, io) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        input: { type: "string", short: "i" },
        json: { type: "boolean" },
        record: { type: "boolean" },
        "no-record": { type: "boolean" },
        remote: { type: "string" },
        cwd: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        url: { type: "string" },
        pr: { type: "string" },
        commit: { type: "string" },
        last: { type: "string" },
        branch: { type: "string" },
        "version-url": { type: "string" },
        deployed: { type: "string" },
        out: { type: "string" },
        "require-clean": { type: "boolean" }
      }
    }));
  } catch (err) {
    io.err(`seamkit: ${err.message}

${HELP}`);
    return EXIT_USAGE;
  }
  const cwd = resolve2(io.cwd, values.cwd ?? ".");
  const [command, ...rest] = positionals;
  try {
    if (values.version || command === "version") {
      io.out(`${VERSION}
`);
      return 0;
    }
    if (values.help || command === void 0 || command === "help") {
      io.out(HELP);
      return command === void 0 && !values.help ? EXIT_USAGE : 0;
    }
    switch (command) {
      case "check":
        return await cmdCheck(rest, values, cwd, io);
      case "checks":
        return cmdChecks(io);
      case "replay":
        return await cmdReplay(rest, values, cwd, io);
      case "state":
        return await cmdState(rest, values, cwd, io);
      case "readback":
        return await cmdReadback(rest, values, cwd, io, false);
      case "audit":
        return await cmdReadback(rest, values, cwd, io, true);
      case "stamp":
        return await cmdStamp(rest, values, cwd, io);
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (err) {
    if (err instanceof UsageError)
      io.err(`seamkit: ${err.message}
Run "seamkit help" for usage.
`);
    else if (err instanceof InputError)
      io.err(`seamkit: input error: ${err.message}
`);
    else if (err instanceof NotAGitRepository || err instanceof StampError)
      io.err(`seamkit: ${err.message}
`);
    else
      io.err(`seamkit: ${err.message}
`);
    return EXIT_USAGE;
  }
}
function detectActor(env) {
  const actor = { kind: "unknown" };
  if (env["GITHUB_ACTIONS"] === "true")
    Object.assign(actor, { kind: "ci", harness: "github-actions" });
  else if (env["CI"] === "true" || env["CI"] === "1")
    actor.kind = "ci";
  else if (env["CLAUDECODE"] === "1") {
    Object.assign(actor, { kind: "agent", harness: "claude-code" });
    if (env["CLAUDE_CODE_SESSION_ID"])
      actor.session = env["CLAUDE_CODE_SESSION_ID"];
  }
  const kind = env["SEAMKIT_ACTOR_KIND"];
  if (kind === "human" || kind === "agent" || kind === "ci")
    actor.kind = kind;
  const handle = env["SEAMKIT_HANDLE"];
  if (handle) {
    if (handle.includes("@"))
      throw new UsageError("SEAMKIT_HANDLE must be a handle, not an email address");
    actor.handle = handle;
  }
  return actor;
}
async function readInput(flags, cwd, io) {
  let text;
  if (flags.input === void 0 || flags.input === "-") {
    if (flags.input === void 0 && io.stdinIsTTY)
      throw new UsageError("give the input with --input <file>, or pipe it on stdin");
    text = await io.readStdin();
  } else {
    text = await readFile(resolve2(cwd, flags.input), "utf8");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new InputError(`input is not valid JSON: ${err.message}`);
  }
}
function print(verdicts, outcome, io, json, extra = {}) {
  if (json) {
    io.out(jsonLine({ outcome, exitCode: exitCodeFor(outcome), verdicts, ...extra }));
    return;
  }
  for (const v of verdicts)
    io.out(`${renderVerdict(v)}

`);
  io.out(`${renderSummary(verdicts)}
`);
}
async function cmdCheck(args, flags, cwd, io) {
  const [name, ...extra] = args;
  if (name === void 0)
    throw new UsageError('check needs a check name; see "seamkit checks"');
  if (extra.length > 0)
    throw new UsageError(`unexpected argument: ${extra[0]}`);
  if (flags.record && flags["no-record"])
    throw new UsageError("--record and --no-record cannot be combined");
  const def = defaultRegistry().get(name);
  if (def === void 0)
    throw new UsageError(`unknown check: ${name}; see "seamkit checks"`);
  const at2 = io.now();
  const run2 = runCheck(def, await readInput(flags, cwd, io), at2);
  const outcome = combine(run2.verdicts.map((v) => v.outcome));
  const recorded = await recordRun(run2, at2, flags, cwd, io);
  print(run2.verdicts, outcome, io, flags.json === true, recorded ? { recorded } : {});
  if (!flags.json)
    noteRecording(recorded, io);
  return exitCodeFor(outcome);
}
async function recordRun(run2, at2, flags, cwd, io) {
  if (flags.record && flags["no-record"])
    throw new UsageError("--record and --no-record cannot be combined");
  if (flags["no-record"])
    return void 0;
  let store;
  try {
    store = await GitStateStore.open(cwd);
  } catch (err) {
    if (!(err instanceof NotAGitRepository) || flags.record)
      throw err;
  }
  if (store === void 0 || !(flags.record || await store.exists()))
    return void 0;
  const event = { v: 1, kind: "verdict", at: at2, actor: detectActor(io.env), tool: { name: "seamkit", version: VERSION }, body: { run: run2 } };
  const r = await store.append(event);
  return { id: r.id, path: r.path };
}
function noteRecording(recorded, io) {
  io.err(recorded ? `recorded as event ${recorded.id.slice(0, 12)} on ${STATE_BRANCH}
` : `not recorded (no ${STATE_BRANCH} branch; run "seamkit state init" or pass --record)
`);
}
function jsonLine(value) {
  return `${JSON.stringify(value).replace(/##\[/g, "##\\u005b")}
`;
}
function productionUrl(flags, env) {
  const raw = flags.url ?? env["SEAMKIT_URL"];
  if (raw === void 0 || raw === "")
    throw new UsageError("give the production URL with --url, or set SEAMKIT_URL");
  return recordableUrl(raw, "--url", "https://your.app");
}
function recordableUrl(raw, flag2, example) {
  let url2;
  try {
    url2 = new URL(raw);
  } catch {
    throw new UsageError(`${flag2} is not an absolute URL; give one such as ${example}`);
  }
  if (url2.protocol !== "http:" && url2.protocol !== "https:")
    throw new UsageError(`${flag2} must be an http or https URL`);
  if (url2.username !== "" || url2.password !== "")
    throw new UsageError(`${flag2} must not contain a user name or password, because URLs are recorded in the ledger`);
  if (url2.search !== "")
    throw new UsageError(`${flag2} must not carry a query string, because URLs are recorded in the ledger`);
  url2.hash = "";
  return url2.href;
}
function positive(value, flag2, fallback, max) {
  if (value === void 0)
    return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max)
    throw new UsageError(`${flag2} must be a whole number from 1 to ${max}`);
  return Number(value);
}
async function cmdReadback(args, flags, cwd, io, audit) {
  if (args.length > 0)
    throw new UsageError(`unexpected argument: ${args[0]}`);
  const command = audit ? "audit" : "readback";
  if (audit && (flags.pr !== void 0 || flags.commit !== void 0))
    throw new UsageError("audit covers the last changes; use readback for one pull request or commit");
  if (flags.pr !== void 0 && flags.commit !== void 0)
    throw new UsageError("--pr and --commit cannot be combined");
  if (flags.record && flags["no-record"])
    throw new UsageError("--record and --no-record cannot be combined");
  const req = { url: productionUrl(flags, io.env), last: positive(flags.last, "--last", 20, 1e3) };
  if (flags.pr !== void 0)
    req.pr = positive(flags.pr, "--pr", 0, Number.MAX_SAFE_INTEGER);
  if (flags.commit !== void 0)
    req.commit = flags.commit;
  if (flags.branch !== void 0)
    req.branch = flags.branch;
  if (flags.deployed !== void 0) {
    if (flags.deployed === "" || flags.deployed.startsWith("-"))
      throw new UsageError("--deployed needs a commit, such as the one the host reports for this deploy");
    req.deployed = flags.deployed;
  }
  if (flags["version-url"] !== void 0)
    req.versionUrl = recordableUrl(flags["version-url"], "--version-url", "https://your.app/version.json");
  const { input: input2, context } = await gatherReadback(cwd, req, io.now, { userAgent: `seamkit/${VERSION} (${command})` });
  const at2 = io.now();
  const run2 = runCheck(readbackCheck, input2, at2);
  const outcome = combine(run2.verdicts.map((v) => v.outcome));
  const recorded = await recordRun(run2, at2, flags, cwd, io);
  const advice = audit ? auditAdvice(context) : [];
  if (flags.json) {
    const v = context.primaryVersion;
    const production = { url: v.url, status: v.status, ...v.commit ? { commit: v.commit } : {}, ...v.reported ? { reported: v.reported } : {}, ...v.reason ? { reason: v.reason } : {} };
    io.out(jsonLine({ outcome, exitCode: exitCodeFor(outcome), verdicts: run2.verdicts, production, ...audit ? { advice } : {}, ...recorded ? { recorded } : {} }));
    return exitCodeFor(outcome);
  }
  io.out(`${renderReadback(run2.verdicts)}
`);
  if (advice.length > 0)
    io.out(`
To examine more:
${advice.map((a) => `  - ${a}`).join("\n")}
`);
  noteRecording(recorded, io);
  return exitCodeFor(outcome);
}
async function cmdStamp(args, flags, cwd, io) {
  if (args.length > 0)
    throw new UsageError(`unexpected argument: ${args[0]}`);
  const req = { requireClean: flags["require-clean"] === true, ...flags.out ? { out: flags.out } : {}, ...flags.commit ? { commit: flags.commit } : {} };
  const { doc, uncommitted: uncommitted2 } = await makeStamp(cwd, req, io.env, io.now());
  const changes = `${uncommitted2.length} uncommitted change${uncommitted2.length === 1 ? "" : "s"} (such as ${uncommitted2[0] ?? ""})`;
  if (doc.dirty === true && req.requireClean) {
    io.err(`seamkit: refusing to stamp a build with ${changes}
`);
    return 1;
  }
  const state = doc.dirty === true ? "with uncommitted changes" : doc.dirty === false ? "clean" : "cleanliness unknown";
  if (flags.out) {
    const path = await writeStamp(cwd, flags.out, doc);
    io.err(`stamped ${path}: ${doc.commit.slice(0, 12)} from ${doc.source}, ${state}
`);
  } else {
    io.out(versionDocText(doc));
  }
  if (doc.dirty === true) {
    io.err(`warning: ${changes}, so this build does not match ${doc.commit.slice(0, 12)}, and readback will not treat its version as proof
`);
  }
  return 0;
}
function cmdChecks(io) {
  for (const def of defaultRegistry().list())
    io.out(`${def.name}@${def.version}  ${def.summary}
`);
  return 0;
}
async function loadFiles(cwd) {
  const store = await GitStateStore.open(cwd);
  const exists = await store.exists();
  return { store, exists, files: exists ? await store.list() : [] };
}
async function cmdReplay(args, flags, cwd, io) {
  const [prefix, ...extra] = args;
  if (extra.length > 0)
    throw new UsageError(`unexpected argument: ${extra[0]}`);
  if (prefix !== void 0 && !/^[0-9a-f]{4,64}$/.test(prefix))
    throw new UsageError("an event id prefix is 4 to 64 hex characters");
  const at2 = io.now();
  const { files: files2 } = await loadFiles(cwd);
  const registry = defaultRegistry();
  const parts = [];
  for (const file of files2) {
    const parsed = parseEventFile(file.path, file.content);
    if (parsed.ok && (parsed.kind !== "verdict" || prefix !== void 0 && !parsed.id.startsWith(prefix)))
      continue;
    if (!parsed.ok) {
      if (prefix !== void 0 && !file.path.includes(`-${prefix}`))
        continue;
      parts.push(assertVerdict({
        check: "replay",
        subject: file.path,
        outcome: "fail",
        state: "corrupt",
        examined: [{ item: "event file", count: 1 }],
        notExamined: [],
        evidence: [{ kind: "hash", value: file.oid, label: "blob" }],
        reasons: parsed.problems.map((p) => `the event file cannot be trusted: ${p}`),
        inputs: digest({ replay: file.path, blob: file.oid }),
        at: at2
      }));
      continue;
    }
    const run2 = parsed.event["body"].run;
    parts.push(replayVerdict(registry, parsed.id, run2, at2));
  }
  const composite = compose("replay", prefix === void 0 ? STATE_BRANCH : `event:${prefix}`, parts, at2);
  if (flags.json)
    print([composite, ...parts], composite.outcome, io, true);
  else {
    for (const v of parts)
      if (v.outcome !== "pass")
        io.out(`${renderVerdict(v)}

`);
    io.out(`${renderVerdict(composite)}

${renderSummary(parts)} replayed
`);
  }
  return exitCodeFor(composite.outcome);
}
async function cmdState(args, flags, cwd, io) {
  const [sub, ...extra] = args;
  if (extra.length > 0)
    throw new UsageError(`unexpected argument: ${extra[0]}`);
  switch (sub) {
    case "init": {
      const store = await GitStateStore.open(cwd);
      const r = await store.init();
      io.out(r.created ? `created ${STATE_BRANCH} at ${r.commit.slice(0, 12)}
` : `${STATE_BRANCH} already exists at ${r.commit.slice(0, 12)}
`);
      return 0;
    }
    case "list": {
      const { files: files2 } = await loadFiles(cwd);
      const rows = files2.map((f) => {
        const parsed = parseEventFile(f.path, f.content);
        if (!parsed.ok)
          return { path: f.path, ok: false, problems: parsed.problems };
        const run2 = parsed.kind === "verdict" ? parsed.event["body"].run : void 0;
        return {
          path: f.path,
          ok: true,
          id: parsed.id,
          kind: parsed.kind,
          at: parsed.event["at"],
          check: run2 ? `${run2.record.check}@${run2.record.version}` : void 0,
          outcomes: run2 ? run2.verdicts.map((v) => v.outcome) : void 0
        };
      });
      if (flags.json)
        io.out(jsonLine(rows));
      else {
        for (const r of rows) {
          io.out(r.ok ? `${String(r.at)}  ${r.id.slice(0, 12)}  ${r.kind}  ${r.check ?? ""}  ${outcomesText(r.outcomes ?? [])}
` : `${r.path}  CORRUPT  ${(r.problems ?? []).join("; ")}
`);
        }
        io.out(`${rows.length} event${rows.length === 1 ? "" : "s"} on ${STATE_BRANCH}
`);
      }
      return 0;
    }
    case "verify": {
      const at2 = io.now();
      const { exists, files: files2 } = await loadFiles(cwd);
      const verdict = integrityVerdict(exists, files2, at2);
      print([verdict], verdict.outcome, io, flags.json === true);
      return exitCodeFor(verdict.outcome);
    }
    case "sync": {
      const store = await GitStateStore.open(cwd);
      const r = await store.sync(flags.remote ?? "origin");
      const messages = {
        up_to_date: `${STATE_BRANCH} is up to date with ${r.remote}`,
        pushed: `pushed ${STATE_BRANCH} to ${r.remote}`,
        pulled: `updated ${STATE_BRANCH} from ${r.remote}`,
        merged: `merged ${STATE_BRANCH} with ${r.remote} and pushed the result`,
        empty: `${STATE_BRANCH} exists neither here nor on ${r.remote}; nothing to do`,
        no_remote: `there is no remote called ${r.remote}`
      };
      if (flags.json)
        io.out(jsonLine(r));
      else
        io.out(`${messages[r.status]}
`);
      return r.status === "no_remote" ? EXIT_USAGE : 0;
    }
    default:
      throw new UsageError(sub === void 0 ? "state needs a subcommand: init, list, verify or sync" : `unknown state subcommand: ${sub}`);
  }
}
function outcomesText(outcomes) {
  return outcomes.length <= 3 ? outcomes.join(",") : `${combine(outcomes)} (${outcomes.length} verdicts)`;
}
function integrityVerdict(exists, files2, at2) {
  const inputs = digest({ integrity: STATE_BRANCH, files: files2.map((f) => [f.path, f.oid]) });
  const base = { check: "state.integrity", subject: STATE_BRANCH, inputs, at: at2, evidence: [] };
  if (!exists || files2.length === 0) {
    return assertVerdict({
      ...base,
      outcome: "examined_nothing",
      examined: [{ item: "event files", count: 0 }],
      notExamined: [],
      reasons: [exists ? `${STATE_BRANCH} holds no event files yet` : `the ${STATE_BRANCH} branch does not exist; run "seamkit state init"`]
    });
  }
  const problems = [];
  const unknownKinds = /* @__PURE__ */ new Map();
  for (const f of files2) {
    const parsed = parseEventFile(f.path, f.content);
    if (!parsed.ok)
      problems.push(...parsed.problems.map((p) => `${f.path}: ${p}`));
    else if (!parsed.known)
      unknownKinds.set(parsed.kind, (unknownKinds.get(parsed.kind) ?? 0) + 1);
  }
  const notExamined = [...unknownKinds].map(([kind, n]) => ({
    item: `schema of ${n} "${kind}" event${n === 1 ? "" : "s"}`,
    reason: "kind not known to this version; hash and canonical form were still checked"
  }));
  const shown = problems.slice(0, 20);
  if (problems.length > shown.length)
    shown.push(`and ${problems.length - shown.length} more problems`);
  return assertVerdict({
    ...base,
    outcome: problems.length > 0 ? "fail" : "pass",
    examined: [{ item: "event files", count: files2.length }],
    notExamined,
    reasons: shown
  });
}

// packages/action/dist/github.js
import { appendFile, readFile as readFile2 } from "node:fs/promises";
var ActionInputError = class extends Error {
  name = "ActionInputError";
};
var input = (env, name) => (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
function checkNameFor(env) {
  const given = input(env, "check-name");
  if (given !== "")
    return given;
  try {
    return `seamkit readback (${new URL(input(env, "url")).host})`;
  } catch {
    return "seamkit readback";
  }
}
function plainText(text, token) {
  return `::stop-commands::${token}
${text}
::${token}::
`;
}
var rawInput = input;
function branchName(raw) {
  const bare = raw.replace(/^(?:refs\/heads\/|heads\/|refs\/remotes\/origin\/|remotes\/origin\/|origin\/)/, "");
  return bare === "HEAD" && bare !== raw ? "" : bare;
}
function readInputs(env) {
  const url2 = input(env, "url");
  if (url2 === "")
    throw new ActionInputError("the url input is required: the production address to read back, such as https://your.app");
  const wait = input(env, "wait") || "60";
  if (!/^[0-9]+$/.test(wait) || Number(wait) > 1800)
    throw new ActionInputError("wait must be a whole number of seconds from 0 to 1800");
  const ledger = input(env, "ledger") || "auto";
  if (ledger !== "auto" && ledger !== "true" && ledger !== "false")
    throw new ActionInputError("ledger must be auto, true or false");
  return {
    url: url2,
    last: input(env, "last"),
    pr: input(env, "pr"),
    branch: branchName(input(env, "branch")),
    versionUrl: input(env, "version-url"),
    waitSeconds: Number(wait),
    ledger,
    checkName: checkNameFor(env),
    token: input(env, "token"),
    sha: input(env, "sha")
  };
}
function readContext(env) {
  const need = (name) => {
    const v = env[name];
    if (v === void 0 || v === "")
      throw new ActionInputError(`${name} is not set; this action runs inside a GitHub Actions job`);
    return v;
  };
  return {
    apiUrl: env["GITHUB_API_URL"] || "https://api.github.com",
    serverUrl: env["GITHUB_SERVER_URL"] || "https://github.com",
    repository: need("GITHUB_REPOSITORY"),
    runId: env["GITHUB_RUN_ID"] ?? "",
    eventName: env["GITHUB_EVENT_NAME"] ?? "",
    eventPath: env["GITHUB_EVENT_PATH"] ?? "",
    sha: env["GITHUB_SHA"] ?? "",
    refName: env["GITHUB_REF_NAME"] ?? "",
    workspace: env["GITHUB_WORKSPACE"] || process.cwd(),
    outputPath: env["GITHUB_OUTPUT"] ?? "",
    summaryPath: env["GITHUB_STEP_SUMMARY"] ?? ""
  };
}
async function readEvent(path) {
  if (path === "")
    return {};
  try {
    return JSON.parse(await readFile2(path, "utf8"));
  } catch {
    return {};
  }
}
var field = (o, ...keys) => keys.reduce((v, k) => v !== null && typeof v === "object" ? v[k] : void 0, o);
var str2 = (v) => typeof v === "string" && v !== "" ? v : void 0;
function headSha(ctx, event, explicit) {
  return deployedCommit(ctx, event, explicit) ?? pullRequestHead(ctx, event) ?? ctx.sha;
}
function deployedCommit(ctx, event, explicit) {
  if (explicit !== "")
    return explicit;
  if (ctx.eventName === "deployment_status" || ctx.eventName === "deployment")
    return str2(field(event, "deployment", "sha"));
  if (ctx.eventName === "workflow_run")
    return str2(field(event, "workflow_run", "head_sha"));
  return void 0;
}
function pullRequestHead(ctx, event) {
  if (ctx.eventName !== "pull_request" && ctx.eventName !== "pull_request_target")
    return void 0;
  return str2(field(event, "pull_request", "head", "sha"));
}
function defaultBranchOf(ctx, event) {
  return str2(field(event, "repository", "default_branch")) ?? (ctx.eventName === "schedule" ? str2(ctx.refName) : void 0);
}
function displayUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:" || u.host === "")
      return "the url input";
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "the url input";
  }
}
function scrub(message, raws) {
  const given = [...new Set(raws)].filter((r) => r.length >= 8).sort((a, b) => b.length - a.length);
  if (given.length === 0)
    return message;
  const pattern = new RegExp(given.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return message.replace(pattern, (raw) => displayUrl(raw));
}
function skipReason(ctx, event) {
  if (ctx.eventName === "deployment_status") {
    const state = str2(field(event, "deployment_status", "state"));
    if (state !== "success")
      return `the deployment is ${state ?? "in an unknown state"}, not success; readback runs once it succeeds`;
  }
  if (ctx.eventName === "workflow_run") {
    const conclusion = str2(field(event, "workflow_run", "conclusion"));
    if (conclusion !== "success")
      return `the deploy workflow concluded ${conclusion ?? "without a conclusion"}, not success`;
    const trigger = str2(field(event, "workflow_run", "event"));
    if (trigger === "pull_request" || trigger === "pull_request_target")
      return "the deploy workflow ran for a pull request, which does not change production";
  }
  return void 0;
}
async function postCheckRun(fetchFn, ctx, token, name, sha, report2, detailsUrl) {
  if (token === "")
    return { ok: false, problem: "no token was given, so no check run was posted" };
  const output = { title: report2.title, summary: report2.summary };
  if (report2.text !== "")
    output["text"] = report2.text;
  const body = { name, head_sha: sha, status: "completed", conclusion: report2.conclusion, ...detailsUrl ? { details_url: detailsUrl } : {}, output };
  let res;
  try {
    res = await fetchFn(`${ctx.apiUrl}/repos/${ctx.repository}/check-runs`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "seamkit-action",
        "x-github-api-version": "2022-11-28"
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return { ok: false, problem: `the check run could not be posted: ${err.message}` };
  }
  let text;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, problem: `the answer to the check run could not be read: ${err.message}` };
  }
  if (res.status === 201) {
    let url2;
    try {
      url2 = str2(JSON.parse(text).html_url);
    } catch {
      url2 = void 0;
    }
    return url2 === void 0 ? { ok: true } : { ok: true, url: url2 };
  }
  if (res.status === 403 || res.status === 404) {
    return { ok: false, problem: `GitHub refused the check run (${res.status}); give the job "permissions: checks: write". Pull requests from forks get a read-only token and cannot post one.` };
  }
  return { ok: false, problem: `GitHub answered ${res.status} to the check run: ${text.slice(0, 300)}` };
}
async function setOutput(path, name, value) {
  if (path === "")
    return;
  const delimiter = `seamkit_${Math.random().toString(36).slice(2)}`;
  await appendFile(path, `${name}<<${delimiter}
${value}
${delimiter}
`);
}
async function appendSummary(path, markdown) {
  if (path !== "")
    await appendFile(path, markdown);
}

// packages/action/dist/report.js
var CONCLUSIONS = {
  pass: "success",
  fail: "failure",
  examined_nothing: "failure",
  unclassified: "action_required"
};
var STATE_LABELS = {
  live: "live",
  not_live: "not live",
  not_proven: "not proven",
  nothing_to_prove: "nothing to prove"
};
var OUTPUT_LIMIT = 65535;
function clip(text, limit) {
  if (text.length <= limit)
    return text;
  const note = "\n\u2026 cut to fit; the full report is in the job log";
  return text.slice(0, limit - note.length) + note;
}
function stateCounts(parts) {
  const order = ["not_live", "not_proven", "nothing_to_prove", "live"];
  return order.map((state) => ({ state, count: parts.filter((p) => p.state === state).length })).filter((c) => c.count > 0);
}
var cell = (s) => s.replace(/\s*[\r\n]\s*/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_[\]!~|]/g, "\\$&");
function fenced(text) {
  let longest = 0;
  for (const m of text.matchAll(/`+/g))
    longest = Math.max(longest, m[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text
${text}
${fence}`;
}
function readbackReport(outcome, verdicts, url2, notes = []) {
  const [summary, ...parts] = verdicts;
  const label = OUTCOME_LABELS[outcome];
  const counts = stateCounts(parts);
  const tally = counts.map((c) => `${c.count} ${STATE_LABELS[c.state]}`).join(", ");
  const title = parts.length === 0 ? `${label}: no changes examined` : `${label}: ${tally} of ${parts.length}`;
  const lines = [`**${label}** for ${url2}`, ""];
  for (const n of notes)
    lines.push(`> ${cell(n)}`, "");
  for (const r of summary?.reasons ?? [])
    lines.push(`- ${cell(r)}`);
  for (const g of summary?.notExamined.filter((x) => !parts.some((p) => x.item.startsWith(`${p.subject}: `))) ?? [])
    lines.push(`- not examined: ${cell(g.item)} (${cell(g.reason)})`);
  if (counts.length > 0) {
    lines.push("", "| State | Changes |", "|---|---|");
    for (const c of counts)
      lines.push(`| ${STATE_LABELS[c.state]} | ${c.count} of ${parts.length} |`);
  }
  const problems = parts.filter((p) => p.outcome !== "pass");
  if (problems.length > 0) {
    lines.push("", "| Change | Outcome | Why |", "|---|---|---|");
    for (const p of problems.slice(0, 50)) {
      const why = cell(p.reasons[0] ?? p.notExamined[0]?.reason ?? "");
      lines.push(`| ${cell(p.subject)} | ${OUTCOME_LABELS[p.outcome]} | ${why} |`);
    }
    if (problems.length > 50)
      lines.push(`| \u2026 | | and ${problems.length - 50} more, in the report below |`);
  }
  return {
    conclusion: CONCLUSIONS[outcome],
    title: clip(title, 1e3),
    summary: clip(lines.join("\n"), OUTPUT_LIMIT),
    text: clip(fenced(renderReadback(verdicts)), OUTPUT_LIMIT)
  };
}
function errorReport(message, url2) {
  const first = message.trim().split("\n")[0] ?? "seamkit could not run";
  return {
    conclusion: "failure",
    title: clip(`No verdict: ${first.replace(/^seamkit: /, "")}`, 1e3),
    summary: clip(`**No verdict** for ${url2}: seamkit could not run, so nothing was proven.

${fenced(message.trim())}`, OUTPUT_LIMIT),
    text: ""
  };
}
function jobSummary(name, report2) {
  return [`### ${name}: ${report2.title}`, "", report2.summary, "", report2.text ? `<details><summary>Full report</summary>

${report2.text}

</details>` : "", ""].join("\n");
}

// packages/action/dist/action.js
var EXIT_USAGE2 = 2;
function cliRunner(cwd, deps) {
  return async (args) => {
    let out = "";
    let err = "";
    const io = {
      out: (t) => void (out += t),
      err: (t) => void (err += t),
      readStdin: async () => "",
      stdinIsTTY: true,
      env: deps.env,
      cwd,
      now: deps.now
    };
    return { code: await run(args, io), out, err };
  };
}
function readbackArgs(inputs, deployed) {
  const args = ["readback", "--url", inputs.url, "--json"];
  if (inputs.last !== "")
    args.push("--last", inputs.last);
  if (inputs.pr !== "")
    args.push("--pr", inputs.pr);
  if (inputs.branch !== "")
    args.push("--branch", inputs.branch);
  if (deployed !== void 0)
    args.push("--deployed", deployed);
  if (inputs.versionUrl !== "")
    args.push("--version-url", inputs.versionUrl);
  return args;
}
async function openLedger(inputs, cli, deps) {
  if (inputs.ledger === "false")
    return false;
  const sync = await cli(["state", "sync", "--json"]);
  if (sync.code !== 0 && /"status":"no_remote"/.test(sync.out)) {
    deps.log("seamkit: the checkout has no origin remote, so this run is not recorded");
    return false;
  }
  if (sync.code !== 0) {
    deps.warn(`seamkit: the ledger could not be fetched, so this run is not recorded: ${sync.err.trim()}`);
    return false;
  }
  const status = JSON.parse(sync.out).status;
  if (status !== "empty") {
    deps.log(`seamkit: ledger ${status === "up_to_date" ? "is up to date" : status}`);
    return true;
  }
  if (inputs.ledger === "auto") {
    deps.log("seamkit: no ledger here or on the remote, so this run is not recorded (set ledger: true to start one)");
    return false;
  }
  const init = await cli(["state", "init"]);
  if (init.code !== 0) {
    deps.warn(`seamkit: the ledger could not be created, so this run is not recorded: ${init.err.trim()}`);
    return false;
  }
  deps.log(`seamkit: ${init.out.trim()}`);
  return true;
}
async function fetchBranch(cwd, name) {
  const tip = await runGit(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${name}:refs/remotes/origin/${name}`], { cwd });
  return tip.code === 0 ? void 0 : tip.stderr.trim() || `git exited ${tip.code}`;
}
async function prepareCheckout(cwd, defaultBranch, branchInput, deps) {
  const shallow = await runGit(["rev-parse", "--is-shallow-repository"], { cwd });
  if (shallow.stdout.toString("utf8").trim() === "true") {
    deps.log("seamkit: the checkout is shallow; fetching the full history (set fetch-depth: 0 on actions/checkout to skip this)");
    const fetched = await runGit(["fetch", "--quiet", "--unshallow", "--no-tags", "origin"], { cwd });
    if (fetched.code !== 0)
      deps.warn(`seamkit: could not fetch the full history, so older changes are not examined: ${fetched.stderr.trim()}`);
  }
  const read = branchInput !== "" ? branchInput : defaultBranch;
  if (read !== void 0) {
    if (!await isBranchName(cwd, read))
      return `${branchInput !== "" ? "the branch input" : "the event's default branch"} ${read} is not a branch name; give the branch changes are merged into, such as main`;
    const failed = await fetchBranch(cwd, read);
    if (failed !== void 0)
      return `could not fetch ${read} from origin, so changes merged since this job's commit cannot be examined: ${failed}`;
  }
  if (defaultBranch === void 0 || !await isBranchName(cwd, defaultBranch))
    return void 0;
  const target = `refs/remotes/origin/${defaultBranch}`;
  if ((await runGit(["rev-parse", "--verify", "--quiet", target], { cwd })).code !== 0)
    return void 0;
  const head = await runGit(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], { cwd });
  if (head.code === 0 && head.stdout.toString("utf8").trim() === target)
    return void 0;
  await runGit(["symbolic-ref", "refs/remotes/origin/HEAD", target], { cwd });
  return void 0;
}
async function fullCommit(cwd, rev) {
  const r = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd });
  return r.code === 0 ? r.stdout.toString("utf8").trim() : rev;
}
function productionOf(result) {
  try {
    return JSON.parse(result.out).production;
  } catch {
    return void 0;
  }
}
async function landing(prod, deployed, cwd) {
  if (prod?.status !== "ok" || prod.reported === void 0)
    return "unknown";
  if (prod.commit === deployed)
    return "runs_it";
  if (prod.commit !== void 0 && (await runGit(["merge-base", "--is-ancestor", deployed, prod.commit], { cwd })).code === 0)
    return "later";
  return "other";
}
async function waitForLive(args, deployed, read, inputs, cli, cwd, deps) {
  const poll = (deps.pollSeconds ?? 10) * 1e3;
  const clock = deps.clock ?? Date.now;
  const start = clock();
  const deadline = start + inputs.waitSeconds * 1e3;
  let lastKnown;
  const refetched = /* @__PURE__ */ new Set();
  const done = (result) => ({ result, ...lastKnown ? { lastKnown } : {}, seconds: Math.round((clock() - start) / 1e3) });
  for (; ; ) {
    const r = await cli([...args, "--no-record"]);
    if (r.code === EXIT_USAGE2 || r.code === 4 || deployed === void 0)
      return done(r);
    const prod = productionOf(r);
    if (prod?.status === "ok" && prod.reported !== void 0 && prod.commit === void 0 && read !== void 0 && !refetched.has(prod.reported)) {
      refetched.add(prod.reported);
      const failed = await fetchBranch(cwd, read);
      if (failed === void 0)
        continue;
      deps.warn(`seamkit: could not fetch ${read} from origin again: ${failed}`);
    }
    const where = await landing(prod, deployed, cwd);
    if (where !== "unknown")
      lastKnown = prod;
    if (where === "runs_it") {
      deps.log(`seamkit: production runs the deployed commit ${deployed.slice(0, 12)}`);
      return done(r);
    }
    if (where === "unknown" && r.code === 0 && lastKnown === void 0)
      return done(r);
    const left = deadline - clock();
    if (left <= 0)
      return done(r);
    const now = where === "unknown" ? "gives no commit" : `reports ${(prod?.reported ?? "").slice(0, 12)}`;
    deps.log(`seamkit: production ${now}, not the deployed commit ${deployed.slice(0, 12)} yet (exit ${r.code}); reading it again in ${Math.round(Math.min(poll, left) / 1e3)}s`);
    await deps.sleep(Math.min(poll, left));
  }
}
async function deployNote(read, deployed, waited, cwd) {
  const prod = read;
  const where = await landing(prod, deployed, cwd);
  const d = deployed.slice(0, 12);
  const running = (prod?.reported ?? "").slice(0, 12);
  if (where === "later") {
    return { notLive: false, note: `Production runs ${running}, which comes after the deployed commit ${d}. A later deploy has landed, or, if this deploy is a rollback, it has not landed yet. The verdict is for what production runs.` };
  }
  if (where === "other" && prod?.commit === void 0) {
    return {
      notLive: true,
      note: `Production runs ${running}, a commit this repository does not have even after fetching the branch, so whether it contains the deployed commit ${d} is not known, after waiting ${waited}s.`,
      title: `FAIL: production runs ${running}, which this repository does not have`
    };
  }
  if (where === "other") {
    return {
      notLive: true,
      note: `Production runs ${running}, which does not contain the deployed commit ${d}, after waiting ${waited}s. The deploy of ${d} has not landed at this address.`,
      title: `FAIL: production does not run the deployed commit ${d}`
    };
  }
  if (where === "unknown") {
    return { notLive: false, note: `Production's version document gave no commit, so whether it runs the deployed commit ${d} is not known. The verdict rests on the markers that were read.` };
  }
  return { notLive: false };
}
async function report(ctx, name, token, sha, result, outcome, code, deps) {
  await written(deps, () => appendSummary(ctx.summaryPath, jobSummary(name, result)));
  await written(deps, () => writeOutputs(ctx.outputPath, { outcome, "exit-code": String(code), title: result.title }));
  const runUrl = ctx.runId === "" ? "" : `${ctx.serverUrl}/${ctx.repository}/actions/runs/${ctx.runId}`;
  const check = sha === "" ? { ok: false, problem: "no commit to attach a check run to" } : await postCheckRun(deps.fetch, ctx, token, name, sha, result, runUrl);
  if (check.ok)
    deps.log(`seamkit: posted check run "${name}" on ${sha.slice(0, 12)}${check.url ? `: ${check.url}` : ""}`);
  else
    deps.warn(`seamkit: ${check.problem ?? "no check run was posted"}`);
  if (check.ok && check.url)
    await written(deps, () => setOutput(ctx.outputPath, "check-run-url", check.url));
}
async function writeOutputs(path, values) {
  for (const [k, v] of Object.entries(values))
    await setOutput(path, k, v);
}
async function written(deps, write) {
  try {
    await write();
  } catch (err) {
    deps.warn(`seamkit: could not write the step outputs or summary: ${err.message}`);
  }
}
var PERMISSION = /\b403\b|denied|permission|not allowed|authentication/i;
async function runAction(deps) {
  let ctx;
  try {
    ctx = readContext(deps.env);
  } catch (err) {
    if (!(err instanceof ActionInputError))
      throw err;
    deps.warn(`seamkit: ${err.message}`);
    return EXIT_USAGE2;
  }
  const event = await readEvent(ctx.eventPath);
  const skip = skipReason(ctx, event);
  if (skip !== void 0) {
    deps.log(`seamkit: skipped, because ${skip}`);
    await written(deps, () => writeOutputs(ctx.outputPath, { outcome: "skipped", "exit-code": "0", title: `Skipped: ${skip}` }));
    return 0;
  }
  let inputs;
  try {
    inputs = readInputs(deps.env);
  } catch (err) {
    if (!(err instanceof ActionInputError))
      throw err;
    deps.warn(`seamkit: ${err.message}`);
    const url2 = rawInput(deps.env, "url");
    await report(ctx, checkNameFor(deps.env), rawInput(deps.env, "token"), headSha(ctx, event, rawInput(deps.env, "sha")), errorReport(err.message, url2 === "" ? "the url input" : displayUrl(url2)), "error", EXIT_USAGE2, deps);
    return EXIT_USAGE2;
  }
  const cwd = ctx.workspace;
  const cli = cliRunner(cwd, deps);
  const given = deployedCommit(ctx, event, inputs.sha);
  const where = displayUrl(inputs.url);
  const defaultBranch = defaultBranchOf(ctx, event);
  const unready = await prepareCheckout(cwd, defaultBranch, inputs.branch, deps);
  const deployed = given === void 0 ? void 0 : await fullCommit(cwd, given);
  let sha = headSha(ctx, event, inputs.sha);
  if (given !== void 0 && sha === given && deployed !== void 0)
    sha = deployed;
  if (unready !== void 0) {
    deps.warn(`seamkit: ${unready}`);
    await report(ctx, inputs.checkName, inputs.token, sha, errorReport(unready, where), "error", EXIT_USAGE2, deps);
    return EXIT_USAGE2;
  }
  const read = inputs.branch !== "" ? inputs.branch : defaultBranch;
  const recording = await openLedger(inputs, cli, deps);
  const args = readbackArgs(inputs, deployed);
  const waited = await waitForLive(args, deployed, read, inputs, cli, cwd, deps);
  let result = waited.result;
  let recorded = false;
  const clean = (text) => scrub(text, [inputs.url, inputs.versionUrl]);
  if (recording && result.code !== EXIT_USAGE2) {
    const resync = await cli(["state", "sync", "--json"]);
    if (resync.code !== 0)
      deps.warn(`seamkit: the ledger could not be fetched again after the wait, so this run judges it as it was: ${clean(resync.err.trim())}`);
    const refetch = read === void 0 ? void 0 : await fetchBranch(cwd, read);
    if (refetch !== void 0)
      deps.warn(`seamkit: could not fetch ${read} from origin again: ${refetch}`);
    const again = await cli(args);
    if (again.code === EXIT_USAGE2)
      deps.warn(`seamkit: the verdict was not recorded: ${clean(again.err.trim())}`);
    else
      result = again;
  }
  let out;
  let outcome = "error";
  let code = result.code;
  if (result.code === EXIT_USAGE2) {
    out = errorReport(clean(result.err), where);
    deps.warn(clean(result.err.trim()));
  } else {
    const parsed = JSON.parse(result.out);
    outcome = parsed.outcome;
    const counted = productionOf(result);
    const reading = deployed !== void 0 && await landing(counted, deployed, cwd) === "unknown" && waited.lastKnown !== void 0 ? waited.lastKnown : counted;
    const deploy = deployed === void 0 || result.code === 4 ? { notLive: false } : await deployNote(reading, deployed, waited.seconds, cwd);
    const overruled = deploy.notLive && outcome === "pass";
    if (overruled) {
      outcome = "fail";
      code = 1;
    }
    out = readbackReport(outcome, parsed.verdicts, where, deploy.note === void 0 ? [] : [deploy.note]);
    if (overruled && deploy.title !== void 0)
      out = { ...out, title: deploy.title };
    deps.log(renderReadback(parsed.verdicts));
    if (deploy.note !== void 0)
      deps.log(`seamkit: ${deploy.note}`);
    if (parsed.recorded) {
      recorded = true;
      deps.log(`seamkit: recorded as event ${parsed.recorded.id.slice(0, 12)}`);
    }
  }
  if (recording) {
    const pushed = await cli(["state", "sync"]);
    if (pushed.code === 0)
      deps.log(`seamkit: ${pushed.out.trim()}`);
    else {
      const why = PERMISSION.test(pushed.err) ? 'give the job "permissions: contents: write"' : "other runs kept pushing while this one retried; give the readback job a concurrency group so deploy runs take turns";
      deps.warn(`seamkit: ${recorded ? "the verdict was recorded here but not pushed, so it is lost with this runner" : "the ledger could not be pushed"}; ${why}: ${pushed.err.trim()}`);
    }
  }
  await report(ctx, inputs.checkName, inputs.token, sha, out, outcome, code, deps);
  return code;
}

// packages/action/dist/main.js
var escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
try {
  process.exitCode = await runAction({
    env: process.env,
    now: () => (/* @__PURE__ */ new Date()).toISOString(),
    sleep: (ms) => new Promise((resolve3) => setTimeout(resolve3, ms)),
    fetch: (url2, init) => fetch(url2, init),
    log: (line) => process.stdout.write(plainText(line, randomUUID())),
    warn: (line) => process.stdout.write(`::warning title=seamkit::${escape(line)}
`)
  });
} catch (err) {
  const message = `seamkit: the action failed: ${err.stack ?? String(err)}`;
  process.stdout.write(`::error title=seamkit::${escape(message)}
`);
  process.exitCode = 2;
  try {
    await setOutput(process.env["GITHUB_OUTPUT"] ?? "", "outcome", "error");
    await setOutput(process.env["GITHUB_OUTPUT"] ?? "", "exit-code", "2");
    await appendSummary(process.env["GITHUB_STEP_SUMMARY"] ?? "", `### seamkit: the action failed

\`\`\`text
${message}
\`\`\`
`);
  } catch {
  }
}
