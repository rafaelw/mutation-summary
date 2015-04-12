// Copyright 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var MutationObserverCtor;
if (typeof WebKitMutationObserver !== 'undefined')
  MutationObserverCtor = WebKitMutationObserver;
else
  MutationObserverCtor = MutationObserver;

if (MutationObserverCtor === undefined) {
  console.error('DOM Mutation Observers are required.');
  console.error('https://developer.mozilla.org/en-US/docs/DOM/MutationObserver');
  throw Error('DOM Mutation Observers are required');
}

interface StringMap<T> {
  [key: string]: T;
}

interface NumberMap<T> {
  [key: number]: T;
}

class NodeMap<T> {

  private static ID_PROP = '__mutation_summary_node_map_id__';
  private static nextId_:number = 1;

  private nodes:Node[];
  private values:T[];

  constructor() {
    this.nodes = [];
    this.values = [];
  }

  private isIndex(s:string):boolean {
    return +s === <any>s >>> 0;
  }

  private nodeId(node:Node) {
    var id = node[NodeMap.ID_PROP];
    if (!id)
      id = node[NodeMap.ID_PROP] = NodeMap.nextId_++;
    return id;
  }

  set(node:Node, value:T) {
    var id = this.nodeId(node);
    this.nodes[id] = node;
    this.values[id] = value;
  }

  get(node:Node):T {
    var id = this.nodeId(node);
    return this.values[id];
  }

  has(node:Node):boolean {
    return this.nodeId(node) in this.nodes;
  }

  delete(node:Node) {
    var id = this.nodeId(node);
    delete this.nodes[id];
    this.values[id] = undefined;
  }

  keys():Node[] {
    var nodes:Node[] = [];
    for (var id in this.nodes) {
      if (!this.isIndex(id))
        continue;
      nodes.push(this.nodes[id]);
    }

    return nodes;
  }
}

/**
 *  var reachableMatchableProduct = [
 *  //  STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED
 *    [ STAYED_OUT,  STAYED_OUT,  STAYED_OUT,  STAYED_OUT ], // STAYED_OUT
 *    [ STAYED_OUT,  ENTERED,     ENTERED,     STAYED_OUT ], // ENTERED
 *    [ STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED     ], // STAYED_IN
 *    [ STAYED_OUT,  STAYED_OUT,  EXITED,      EXITED     ]  // EXITED
 *  ];
 */

enum Movement {
  STAYED_OUT,
  ENTERED,
  STAYED_IN,
  REPARENTED,
  REORDERED,
  EXITED
}

function enteredOrExited(changeType:Movement):boolean {
  return changeType === Movement.ENTERED || changeType === Movement.EXITED;
}

class NodeChange {

  public isCaseInsensitive:boolean;

  constructor(public node:Node,
              public childList:boolean = false,
              public attributes:boolean = false,
              public characterData:boolean = false,
              public oldParentNode:Node = null,
              public added:boolean = false,
              private attributeOldValues:StringMap<string> = null,
              public characterDataOldValue:string = null) {
    this.isCaseInsensitive =
        this.node.nodeType === Node.ELEMENT_NODE &&
        this.node instanceof HTMLElement &&
        this.node.ownerDocument instanceof HTMLDocument;
  }

  getAttributeOldValue(name:string):string {
    if (!this.attributeOldValues)
      return undefined;
    if (this.isCaseInsensitive)
      name = name.toLowerCase();
    return this.attributeOldValues[name];
  }

  getAttributeNamesMutated():string[] {
    var names:string[] = [];
    if (!this.attributeOldValues)
      return names;
    for (var name in this.attributeOldValues) {
      names.push(name);
    }
    return names;
  }

  attributeMutated(name:string, oldValue:string) {
    this.attributes = true;
    this.attributeOldValues = this.attributeOldValues || {};

    if (name in this.attributeOldValues)
      return;

    this.attributeOldValues[name] = oldValue;
  }

  characterDataMutated(oldValue:string) {
    if (this.characterData)
      return;
    this.characterData = true;
    this.characterDataOldValue = oldValue;
  }

  // Note: is it possible to receive a removal followed by a removal. This
  // can occur if the removed node is added to an non-observed node, that
  // node is added to the observed area, and then the node removed from
  // it.
  removedFromParent(parent:Node) {
    this.childList = true;
    if (this.added || this.oldParentNode)
      this.added = false;
    else
      this.oldParentNode = parent;
  }

  insertedIntoParent() {
    this.childList = true;
    this.added = true;
  }

  // An node's oldParent is
  //   -its present parent, if its parentNode was not changed.
  //   -null if the first thing that happened to it was an add.
  //   -the node it was removed from if the first thing that happened to it
  //      was a remove.
  getOldParent() {
    if (this.childList) {
      if (this.oldParentNode)
        return this.oldParentNode;
      if (this.added)
        return null;
    }

    return this.node.parentNode;
  }
}

class ChildListChange {

  public added:NodeMap<boolean>;
  public removed:NodeMap<boolean>;
  public maybeMoved:NodeMap<boolean>;
  public oldPrevious:NodeMap<Node>;
  public moved:NodeMap<boolean>;

  constructor() {
    this.added = new NodeMap<boolean>();
    this.removed = new NodeMap<boolean>();
    this.maybeMoved = new NodeMap<boolean>();
    this.oldPrevious = new NodeMap<Node>();
    this.moved = undefined;
  }
}

class TreeChanges extends NodeMap<NodeChange> {

  public anyParentsChanged:boolean;
  public anyAttributesChanged:boolean;
  public anyCharacterDataChanged:boolean;

  private reachableCache:NodeMap<boolean>;
  private wasReachableCache:NodeMap<boolean>;

  private rootNode:Node;

  constructor(rootNode:Node, mutations:MutationRecord[]) {
    super();

    this.rootNode = rootNode;
    this.reachableCache = undefined;
    this.wasReachableCache = undefined;
    this.anyParentsChanged = false;
    this.anyAttributesChanged = false;
    this.anyCharacterDataChanged = false;

    for (var m = 0; m < mutations.length; m++) {
      var mutation = mutations[m];
      switch (mutation.type) {

        case 'childList':
          this.anyParentsChanged = true;
          for (var i = 0; i < mutation.removedNodes.length; i++) {
            var node = mutation.removedNodes[i];
            this.getChange(node).removedFromParent(mutation.target);
          }
          for (var i = 0; i < mutation.addedNodes.length; i++) {
            var node = mutation.addedNodes[i];
            this.getChange(node).insertedIntoParent();
          }
          break;

        case 'attributes':
          this.anyAttributesChanged = true;
          var change = this.getChange(mutation.target);
          change.attributeMutated(mutation.attributeName, mutation.oldValue);
          break;

        case 'characterData':
          this.anyCharacterDataChanged = true;
          var change = this.getChange(mutation.target);
          change.characterDataMutated(mutation.oldValue);
          break;
      }
    }
  }

  getChange(node:Node):NodeChange {
    var change = this.get(node);
    if (!change) {
      change = new NodeChange(node);
      this.set(node, change);
    }
    return change;
  }

  getOldParent(node:Node):Node {
    var change = this.get(node);
    return change ? change.getOldParent() : node.parentNode;
  }

  getIsReachable(node:Node):boolean {
    if (node === this.rootNode)
      return true;
    if (!node)
      return false;

    this.reachableCache = this.reachableCache || new NodeMap<boolean>();
    var isReachable = this.reachableCache.get(node);
    if (isReachable === undefined) {
      isReachable = this.getIsReachable(node.parentNode);
      this.reachableCache.set(node, isReachable);
    }
    return isReachable;
  }

  // A node wasReachable if its oldParent wasReachable.
  getWasReachable(node:Node):boolean {
    if (node === this.rootNode)
      return true;
    if (!node)
      return false;

    this.wasReachableCache = this.wasReachableCache || new NodeMap<boolean>();
    var wasReachable:boolean = this.wasReachableCache.get(node);
    if (wasReachable === undefined) {
      wasReachable = this.getWasReachable(this.getOldParent(node));
      this.wasReachableCache.set(node, wasReachable);
    }
    return wasReachable;
  }

  reachabilityChange(node:Node):Movement {
    if (this.getIsReachable(node)) {
      return this.getWasReachable(node) ?
        Movement.STAYED_IN : Movement.ENTERED;
    }

    return this.getWasReachable(node) ?
      Movement.EXITED : Movement.STAYED_OUT;
  }
}

class MutationProjection {

  private treeChanges:TreeChanges;
  private entered:Node[];
  private exited:Node[];
  private stayedIn:NodeMap<Movement>;
  private visited:NodeMap<boolean>;
  private childListChangeMap:NodeMap<ChildListChange>;
  private characterDataOnly:boolean;
  private matchCache:NumberMap<NodeMap<Movement>>;

  // TOOD(any)
  constructor(public rootNode:Node,
              public mutations:MutationRecord[],
              public selectors:Selector[],
              public calcReordered:boolean,
              public calcOldPreviousSibling:boolean) {

    this.treeChanges = new TreeChanges(rootNode, mutations);
    this.entered = [];
    this.exited = [];
    this.stayedIn = new NodeMap<Movement>();
    this.visited = new NodeMap<boolean>();
    this.childListChangeMap = undefined;
    this.characterDataOnly = undefined;
    this.matchCache = undefined;

    this.processMutations();
  }

  processMutations() {
    if (!this.treeChanges.anyParentsChanged &&
        !this.treeChanges.anyAttributesChanged)
      return;

    var changedNodes:Node[] = this.treeChanges.keys();
    for (var i = 0; i < changedNodes.length; i++) {
      this.visitNode(changedNodes[i], undefined);
    }
  }

  visitNode(node:Node, parentReachable:Movement) {
    if (this.visited.has(node))
      return;

    this.visited.set(node, true);

    var change = this.treeChanges.get(node);
    var reachable = parentReachable;

    // node inherits its parent's reachability change unless
    // its parentNode was mutated.
    if ((change && change.childList) || reachable == undefined)
      reachable = this.treeChanges.reachabilityChange(node);

    if (reachable === Movement.STAYED_OUT)
      return;

    // Cache match results for sub-patterns.
    this.matchabilityChange(node);

    if (reachable === Movement.ENTERED) {
      this.entered.push(node);
    } else if (reachable === Movement.EXITED) {
      this.exited.push(node);
      this.ensureHasOldPreviousSiblingIfNeeded(node);

    } else if (reachable === Movement.STAYED_IN) {
      var movement = Movement.STAYED_IN;

      if (change && change.childList) {
        if (change.oldParentNode !== node.parentNode) {
          movement = Movement.REPARENTED;
          this.ensureHasOldPreviousSiblingIfNeeded(node);
        } else if (this.calcReordered && this.wasReordered(node)) {
          movement = Movement.REORDERED;
        }
      }

      this.stayedIn.set(node, movement);
    }

    if (reachable === Movement.STAYED_IN)
      return;

    // reachable === ENTERED || reachable === EXITED.
    for (var child = node.firstChild; child; child = child.nextSibling) {
      this.visitNode(child, reachable);
    }
  }

  ensureHasOldPreviousSiblingIfNeeded(node:Node) {
    if (!this.calcOldPreviousSibling)
      return;

    this.processChildlistChanges();

    var parentNode = node.parentNode;
    var nodeChange = this.treeChanges.get(node);
    if (nodeChange && nodeChange.oldParentNode)
      parentNode = nodeChange.oldParentNode;

    var change = this.childListChangeMap.get(parentNode);
    if (!change) {
      change = new ChildListChange();
      this.childListChangeMap.set(parentNode, change);
    }

    if (!change.oldPrevious.has(node)) {
      change.oldPrevious.set(node, node.previousSibling);
    }
  }

  getChanged(summary:Summary, selectors:Selector[], characterDataOnly:boolean) {
    this.selectors = selectors;
    this.characterDataOnly = characterDataOnly;

    for (var i = 0; i < this.entered.length; i++) {
      var node = this.entered[i];
      var matchable = this.matchabilityChange(node);
      if (matchable === Movement.ENTERED || matchable === Movement.STAYED_IN)
        summary.added.push(node);
    }

    var stayedInNodes = this.stayedIn.keys();
    for (var i = 0; i < stayedInNodes.length; i++) {
      var node = stayedInNodes[i];
      var matchable = this.matchabilityChange(node);

      if (matchable === Movement.ENTERED) {
        summary.added.push(node);
      } else if (matchable === Movement.EXITED) {
        summary.removed.push(node);
      } else if (matchable === Movement.STAYED_IN && (summary.reparented || summary.reordered)) {
        var movement:Movement = this.stayedIn.get(node);
        if (summary.reparented && movement === Movement.REPARENTED)
          summary.reparented.push(node);
        else if (summary.reordered && movement === Movement.REORDERED)
          summary.reordered.push(node);
      }
    }

    for (var i = 0; i < this.exited.length; i++) {
      var node = this.exited[i];
      var matchable = this.matchabilityChange(node);
      if (matchable === Movement.EXITED || matchable === Movement.STAYED_IN)
        summary.removed.push(node);
    }
  }

  getOldParentNode(node:Node):Node {
    var change = this.treeChanges.get(node);
    if (change && change.childList)
      return change.oldParentNode ? change.oldParentNode : null;

    var reachabilityChange = this.treeChanges.reachabilityChange(node);
    if (reachabilityChange === Movement.STAYED_OUT || reachabilityChange === Movement.ENTERED)
      throw Error('getOldParentNode requested on invalid node.');

    return node.parentNode;
  }

  getOldPreviousSibling(node:Node):Node {
    var parentNode = node.parentNode;
    var nodeChange = this.treeChanges.get(node);
    if (nodeChange && nodeChange.oldParentNode)
      parentNode = nodeChange.oldParentNode;

    var change = this.childListChangeMap.get(parentNode);
    if (!change)
      throw Error('getOldPreviousSibling requested on invalid node.');

    return change.oldPrevious.get(node);
  }

  getOldAttribute(element:Node, attrName:string):string {
    var change = this.treeChanges.get(element);
    if (!change || !change.attributes)
      throw Error('getOldAttribute requested on invalid node.');

    var value = change.getAttributeOldValue(attrName);
    if (value === undefined)
      throw Error('getOldAttribute requested for unchanged attribute name.');

    return value;
  }

  attributeChangedNodes(includeAttributes:string[]):StringMap<Element[]> {
    if (!this.treeChanges.anyAttributesChanged)
      return {}; // No attributes mutations occurred.

    var attributeFilter:StringMap<boolean>;
    var caseInsensitiveFilter:StringMap<string>;
    if (includeAttributes) {
      attributeFilter = {};
      caseInsensitiveFilter = {};
      for (var i = 0; i < includeAttributes.length; i++) {
        var attrName:string = includeAttributes[i];
        attributeFilter[attrName] = true;
        caseInsensitiveFilter[attrName.toLowerCase()] = attrName;
      }
    }

    var result:StringMap<Element[]> = {};
    var nodes = this.treeChanges.keys();

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      var change = this.treeChanges.get(node);
      if (!change.attributes)
        continue;

      if (Movement.STAYED_IN !== this.treeChanges.reachabilityChange(node) ||
          Movement.STAYED_IN !== this.matchabilityChange(node)) {
        continue;
      }

      var element = <Element>node;
      var changedAttrNames = change.getAttributeNamesMutated();
      for (var j = 0; j < changedAttrNames.length; j++) {
        var attrName = changedAttrNames[j];

        if (attributeFilter &&
            !attributeFilter[attrName] &&
            !(change.isCaseInsensitive && caseInsensitiveFilter[attrName])) {
          continue;
        }

        var oldValue = change.getAttributeOldValue(attrName);
        if (oldValue === element.getAttribute(attrName))
          continue;

        if (caseInsensitiveFilter && change.isCaseInsensitive)
          attrName = caseInsensitiveFilter[attrName];

        result[attrName] = result[attrName] || [];
        result[attrName].push(element);
      }
    }

    return result;
  }

  getOldCharacterData(node:Node):string {
    var change = this.treeChanges.get(node);
    if (!change || !change.characterData)
      throw Error('getOldCharacterData requested on invalid node.');

    return change.characterDataOldValue;
  }

  getCharacterDataChanged():Node[] {
    if (!this.treeChanges.anyCharacterDataChanged)
      return []; // No characterData mutations occurred.

    var nodes = this.treeChanges.keys();
    var result:Node[] = [];
    for (var i = 0; i < nodes.length; i++) {
      var target = nodes[i];
      if (Movement.STAYED_IN !== this.treeChanges.reachabilityChange(target))
        continue;

      var change = this.treeChanges.get(target);
      if (!change.characterData ||
          target.textContent == change.characterDataOldValue)
        continue

      result.push(target);
    }

    return result;
  }

  computeMatchabilityChange(selector:Selector, el:Element):Movement {
    if (!this.matchCache)
      this.matchCache = [];
    if (!this.matchCache[selector.uid])
      this.matchCache[selector.uid] = new NodeMap<Movement>();

    var cache = this.matchCache[selector.uid];
    var result = cache.get(el);
    if (result === undefined) {
      result = selector.matchabilityChange(el, this.treeChanges.get(el));
      cache.set(el, result);
    }
    return result;
  }

  matchabilityChange(node:Node) {
    // TODO(rafaelw): Include PI, CDATA?
    // Only include text nodes.
    if (this.characterDataOnly) {
      switch (node.nodeType) {
        case Node.COMMENT_NODE:
        case Node.TEXT_NODE:
          return Movement.STAYED_IN;
        default:
          return Movement.STAYED_OUT;
      }
    }

    // No element filter. Include all nodes.
    if (!this.selectors)
      return Movement.STAYED_IN;

    // Element filter. Exclude non-elements.
    if (node.nodeType !== Node.ELEMENT_NODE)
      return Movement.STAYED_OUT;

    var el = <Element>node;

    var matchChanges = this.selectors.map((selector:Selector) => {
      return this.computeMatchabilityChange(selector, el);
    });

    var accum:Movement = Movement.STAYED_OUT;
    var i = 0;

    while (accum !== Movement.STAYED_IN && i < matchChanges.length) {
      switch(matchChanges[i]) {
        case Movement.STAYED_IN:
          accum = Movement.STAYED_IN;
          break;
        case Movement.ENTERED:
          if (accum === Movement.EXITED)
            accum = Movement.STAYED_IN;
          else
            accum = Movement.ENTERED;
          break;
        case Movement.EXITED:
          if (accum === Movement.ENTERED)
            accum = Movement.STAYED_IN;
          else
            accum = Movement.EXITED;
          break;
      }

      i++;
    }

    return accum;
  }

  getChildlistChange(el:Element):ChildListChange {
    var change = this.childListChangeMap.get(el);
    if (!change) {
      change = new ChildListChange();
      this.childListChangeMap.set(el, change);
    }

    return change;
  }

  processChildlistChanges() {
    if (this.childListChangeMap)
      return;

    this.childListChangeMap = new NodeMap<ChildListChange>();

    for (var i = 0; i < this.mutations.length; i++) {
      var mutation = this.mutations[i];
      if (mutation.type != 'childList')
        continue;

      if (this.treeChanges.reachabilityChange(mutation.target) !== Movement.STAYED_IN &&
          !this.calcOldPreviousSibling)
        continue;

      var change = this.getChildlistChange(<Element>mutation.target);

      var oldPrevious = mutation.previousSibling;

      function recordOldPrevious(node:Node, previous:Node) {
        if (!node ||
            change.oldPrevious.has(node) ||
            change.added.has(node) ||
            change.maybeMoved.has(node))
          return;

        if (previous &&
            (change.added.has(previous) ||
             change.maybeMoved.has(previous)))
          return;

        change.oldPrevious.set(node, previous);
      }

      for (var j = 0; j < mutation.removedNodes.length; j++) {
        var node = mutation.removedNodes[j];
        recordOldPrevious(node, oldPrevious);

        if (change.added.has(node)) {
          change.added.delete(node);
        } else {
          change.removed.set(node, true);
          change.maybeMoved.delete(node);
        }

        oldPrevious = node;
      }

      recordOldPrevious(mutation.nextSibling, oldPrevious);

      for (var j = 0; j < mutation.addedNodes.length; j++) {
        var node = mutation.addedNodes[j];
        if (change.removed.has(node)) {
          change.removed.delete(node);
          change.maybeMoved.set(node, true);
        } else {
          change.added.set(node, true);
        }
      }
    }
  }

  wasReordered(node:Node) {
    if (!this.treeChanges.anyParentsChanged)
      return false;

    this.processChildlistChanges();

    var parentNode = node.parentNode;
    var nodeChange = this.treeChanges.get(node);
    if (nodeChange && nodeChange.oldParentNode)
      parentNode = nodeChange.oldParentNode;

    var change = this.childListChangeMap.get(parentNode);
    if (!change)
      return false;

    if (change.moved)
      return change.moved.get(node);

    change.moved = new NodeMap<boolean>();
    var pendingMoveDecision = new NodeMap<boolean>();

    function isMoved(node:Node) {
      if (!node)
        return false;
      if (!change.maybeMoved.has(node))
        return false;

      var didMove = change.moved.get(node);
      if (didMove !== undefined)
        return didMove;

      if (pendingMoveDecision.has(node)) {
        didMove = true;
      } else {
        pendingMoveDecision.set(node, true);
        didMove = getPrevious(node) !== getOldPrevious(node);
      }

      if (pendingMoveDecision.has(node)) {
        pendingMoveDecision.delete(node);
        change.moved.set(node, didMove);
      } else {
        didMove = change.moved.get(node);
      }

      return didMove;
    }

    var oldPreviousCache = new NodeMap<Node>();
    function getOldPrevious(node:Node):Node {
      var oldPrevious = oldPreviousCache.get(node);
      if (oldPrevious !== undefined)
        return oldPrevious;

      oldPrevious = change.oldPrevious.get(node);
      while (oldPrevious &&
             (change.removed.has(oldPrevious) || isMoved(oldPrevious))) {
        oldPrevious = getOldPrevious(oldPrevious);
      }

      if (oldPrevious === undefined)
        oldPrevious = node.previousSibling;
      oldPreviousCache.set(node, oldPrevious);

      return oldPrevious;
    }

    var previousCache = new NodeMap<Node>();
    function getPrevious(node:Node):Node {
      if (previousCache.has(node))
        return previousCache.get(node);

      var previous = node.previousSibling;
      while (previous && (change.added.has(previous) || isMoved(previous)))
        previous = previous.previousSibling;

      previousCache.set(node, previous);
      return previous;
    }

    change.maybeMoved.keys().forEach(isMoved);
    return change.moved.get(node);
  }
}

class Summary {
  public added:Node[];
  public removed:Node[];
  public reparented:Node[];
  public reordered:Node[];
  public valueChanged:Node[];
  public attributeChanged:StringMap<Element[]>;
  public characterDataChanged:Node[];

  constructor(private projection:MutationProjection, query:Query) {
    this.added = [];
    this.removed = [];
    this.reparented = query.all || query.element || query.characterData ? [] : undefined;
    this.reordered = query.all ? [] : undefined;

    projection.getChanged(this, query.elementFilter, query.characterData);

    if (query.all || query.attribute || query.attributeList) {
      var filter = query.attribute ? [ query.attribute ] : query.attributeList;
      var attributeChanged = projection.attributeChangedNodes(filter);

      if (query.attribute) {
        this.valueChanged = attributeChanged[query.attribute] || [];
      } else {
        this.attributeChanged = attributeChanged;
        if (query.attributeList) {
          query.attributeList.forEach((attrName) => {
            if (!this.attributeChanged.hasOwnProperty(attrName))
              this.attributeChanged[attrName] = [];
          });
        }
      }
    }

    if (query.all || query.characterData) {
      var characterDataChanged = projection.getCharacterDataChanged()

      if (query.characterData)
        this.valueChanged = characterDataChanged;
      else
        this.characterDataChanged = characterDataChanged;
    }

    if (this.reordered)
      this.getOldPreviousSibling = projection.getOldPreviousSibling.bind(projection);
  }

  getOldParentNode(node:Node):Node {
    return this.projection.getOldParentNode(node);
  }

  getOldAttribute(node:Node, name: string):string {
    return this.projection.getOldAttribute(node, name);
  }

  getOldCharacterData(node:Node):string {
    return this.projection.getOldCharacterData(node);
  }

  getOldPreviousSibling(node:Node):Node {
    return this.projection.getOldPreviousSibling(node);
  }
}

// TODO(rafaelw): Allow ':' and '.' as valid name characters.
var validNameInitialChar = /[a-zA-Z_]+/;
var validNameNonInitialChar = /[a-zA-Z0-9_\-]+/;

// TODO(rafaelw): Consider allowing backslash in the attrValue.
// TODO(rafaelw): There's got a to be way to represent this state machine
// more compactly???

function escapeQuotes(value:string):string {
  return '"' + value.replace(/"/, '\\\"') + '"';
}

class Qualifier {
  public attrName:string;
  public attrValue:string;
  public contains:boolean;

  constructor() {}

  public matches(oldValue:string):boolean {
    if (oldValue === null)
      return false;

    if (this.attrValue === undefined)
      return true;

    if (!this.contains)
      return this.attrValue == oldValue;

    var tokens = oldValue.split(' ');
    for (var i = 0; i < tokens.length; i++) {
      if (this.attrValue === tokens[i])
        return true;
    }

    return false;
  }

  public toString():string {
    if (this.attrName === 'class' && this.contains)
      return '.' + this.attrValue;

    if (this.attrName === 'id' && !this.contains)
      return '#' + this.attrValue;

    if (this.contains)
      return '[' + this.attrName + '~=' + escapeQuotes(this.attrValue) + ']';

    if ('attrValue' in this)
      return '[' + this.attrName + '=' + escapeQuotes(this.attrValue) + ']';

    return '[' + this.attrName + ']';
  }
}

class Selector {
  private static nextUid:number = 1;
  private static matchesSelector:string = (function(){
    var element = document.createElement('div');
    if (typeof element['webkitMatchesSelector'] === 'function')
      return 'webkitMatchesSelector';
    if (typeof element['mozMatchesSelector'] === 'function')
      return 'mozMatchesSelector';
    if (typeof element['msMatchesSelector'] === 'function')
      return 'msMatchesSelector';

    return 'matchesSelector';
  })();

  public tagName:string;
  public qualifiers:Qualifier[];
  public uid:number;

  private get caseInsensitiveTagName():string {
    return this.tagName.toUpperCase();
  }

  get selectorString() {
    return this.tagName + this.qualifiers.join('');
  }

  constructor() {
    this.uid = Selector.nextUid++;
    this.qualifiers = [];
  }

  private isMatching(el:Element):boolean {
    return el[Selector.matchesSelector](this.selectorString);
  }

  private wasMatching(el:Element, change:NodeChange, isMatching:boolean):boolean {
    if (!change || !change.attributes)
      return isMatching;

    var tagName = change.isCaseInsensitive ? this.caseInsensitiveTagName : this.tagName;
    if (tagName !== '*' && tagName !== el.tagName)
      return false;

    var attributeOldValues:string[] = [];
    var anyChanged = false;
    for (var i = 0; i < this.qualifiers.length; i++) {
      var qualifier = this.qualifiers[i];
      var oldValue = change.getAttributeOldValue(qualifier.attrName);
      attributeOldValues.push(oldValue);
      anyChanged = anyChanged || (oldValue !== undefined);
    }

    if (!anyChanged)
      return isMatching;

    for (var i = 0; i < this.qualifiers.length; i++) {
      var qualifier = this.qualifiers[i];
      var oldValue = attributeOldValues[i];
      if (oldValue === undefined)
        oldValue = el.getAttribute(qualifier.attrName);
      if (!qualifier.matches(oldValue))
        return false;
    }

    return true;
  }

  public matchabilityChange(el:Element, change:NodeChange):Movement {
    var isMatching = this.isMatching(el);
    if (isMatching)
      return this.wasMatching(el, change, isMatching) ? Movement.STAYED_IN : Movement.ENTERED;
    else
      return this.wasMatching(el, change, isMatching) ? Movement.EXITED : Movement.STAYED_OUT;
  }

  public static parseSelectors(input:string):Selector[] {
    var selectors:Selector[] = [];
    var currentSelector:Selector;
    var currentQualifier:Qualifier;

    function newSelector() {
      if (currentSelector) {
        if (currentQualifier) {
          currentSelector.qualifiers.push(currentQualifier);
          currentQualifier = undefined;
        }

        selectors.push(currentSelector);
      }
      currentSelector = new Selector();
    }

    function newQualifier() {
      if (currentQualifier)
        currentSelector.qualifiers.push(currentQualifier);

      currentQualifier = new Qualifier();
    }

    var WHITESPACE = /\s/;
    var valueQuoteChar:string;
    var SYNTAX_ERROR = 'Invalid or unsupported selector syntax.';

    var SELECTOR = 1;
    var TAG_NAME = 2;
    var QUALIFIER = 3;
    var QUALIFIER_NAME_FIRST_CHAR = 4;
    var QUALIFIER_NAME = 5;
    var ATTR_NAME_FIRST_CHAR = 6;
    var ATTR_NAME = 7;
    var EQUIV_OR_ATTR_QUAL_END = 8;
    var EQUAL = 9;
    var ATTR_QUAL_END = 10;
    var VALUE_FIRST_CHAR = 11;
    var VALUE = 12;
    var QUOTED_VALUE = 13;
    var SELECTOR_SEPARATOR = 14;

    var state = SELECTOR;
    var i = 0;
    while (i < input.length) {
      var c = input[i++];

      switch (state) {
        case SELECTOR:
          if (c.match(validNameInitialChar)) {
            newSelector();
            currentSelector.tagName = c;
            state = TAG_NAME;
            break;
          }

          if (c == '*') {
            newSelector();
            currentSelector.tagName = '*';
            state = QUALIFIER;
            break;
          }

          if (c == '.') {
            newSelector();
            newQualifier();
            currentSelector.tagName = '*';
            currentQualifier.attrName = 'class';
            currentQualifier.contains = true;
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '#') {
            newSelector();
            newQualifier();
            currentSelector.tagName = '*';
            currentQualifier.attrName = 'id';
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '[') {
            newSelector();
            newQualifier();
            currentSelector.tagName = '*';
            currentQualifier.attrName = '';
            state = ATTR_NAME_FIRST_CHAR;
            break;
          }

          if (c.match(WHITESPACE))
            break;

          throw Error(SYNTAX_ERROR);

        case TAG_NAME:
          if (c.match(validNameNonInitialChar)) {
            currentSelector.tagName += c;
            break;
          }

          if (c == '.') {
            newQualifier();
            currentQualifier.attrName = 'class';
            currentQualifier.contains = true;
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '#') {
            newQualifier();
            currentQualifier.attrName = 'id';
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '[') {
            newQualifier();
            currentQualifier.attrName = '';
            state = ATTR_NAME_FIRST_CHAR;
            break;
          }

          if (c.match(WHITESPACE)) {
            state = SELECTOR_SEPARATOR;
            break;
          }

          if (c == ',') {
            state = SELECTOR;
            break;
          }

          throw Error(SYNTAX_ERROR);

        case QUALIFIER:
          if (c == '.') {
            newQualifier();
            currentQualifier.attrName = 'class';
            currentQualifier.contains = true;
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '#') {
            newQualifier();
            currentQualifier.attrName = 'id';
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '[') {
            newQualifier();
            currentQualifier.attrName = '';
            state = ATTR_NAME_FIRST_CHAR;
            break;
          }

          if (c.match(WHITESPACE)) {
            state = SELECTOR_SEPARATOR;
            break;
          }

          if (c == ',') {
            state = SELECTOR;
            break;
          }

          throw Error(SYNTAX_ERROR);

        case QUALIFIER_NAME_FIRST_CHAR:
          if (c.match(validNameInitialChar)) {
            currentQualifier.attrValue = c;
            state = QUALIFIER_NAME;
            break;
          }

          throw Error(SYNTAX_ERROR);

        case QUALIFIER_NAME:
          if (c.match(validNameNonInitialChar)) {
            currentQualifier.attrValue += c;
            break;
          }

          if (c == '.') {
            newQualifier();
            currentQualifier.attrName = 'class';
            currentQualifier.contains = true;
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '#') {
            newQualifier();
            currentQualifier.attrName = 'id';
            state = QUALIFIER_NAME_FIRST_CHAR;
            break;
          }
          if (c == '[') {
            newQualifier();
            state = ATTR_NAME_FIRST_CHAR;
            break;
          }

          if (c.match(WHITESPACE)) {
            state = SELECTOR_SEPARATOR;
            break;
          }
          if (c == ',') {
            state = SELECTOR;
            break
          }

          throw Error(SYNTAX_ERROR);

        case ATTR_NAME_FIRST_CHAR:
          if (c.match(validNameInitialChar)) {
            currentQualifier.attrName = c;
            state = ATTR_NAME;
            break;
          }

          if (c.match(WHITESPACE))
            break;

          throw Error(SYNTAX_ERROR);

        case ATTR_NAME:
          if (c.match(validNameNonInitialChar)) {
            currentQualifier.attrName += c;
            break;
          }

          if (c.match(WHITESPACE)) {
            state = EQUIV_OR_ATTR_QUAL_END;
            break;
          }

          if (c == '~') {
            currentQualifier.contains = true;
            state = EQUAL;
            break;
          }

          if (c == '=') {
            currentQualifier.attrValue = '';
            state = VALUE_FIRST_CHAR;
            break;
          }

          if (c == ']') {
            state = QUALIFIER;
            break;
          }

          throw Error(SYNTAX_ERROR);

        case EQUIV_OR_ATTR_QUAL_END:
          if (c == '~') {
            currentQualifier.contains = true;
            state = EQUAL;
            break;
          }

          if (c == '=') {
            currentQualifier.attrValue = '';
            state = VALUE_FIRST_CHAR;
            break;
          }

          if (c == ']') {
            state = QUALIFIER;
            break;
          }

          if (c.match(WHITESPACE))
            break;

          throw Error(SYNTAX_ERROR);

        case EQUAL:
          if (c == '=') {
            currentQualifier.attrValue = '';
            state = VALUE_FIRST_CHAR
            break;
          }

          throw Error(SYNTAX_ERROR);

        case ATTR_QUAL_END:
          if (c == ']') {
            state = QUALIFIER;
            break;
          }

          if (c.match(WHITESPACE))
            break;

          throw Error(SYNTAX_ERROR);

        case VALUE_FIRST_CHAR:
          if (c.match(WHITESPACE))
            break;

          if (c == '"' || c == "'") {
            valueQuoteChar = c;
            state = QUOTED_VALUE;
            break;
          }

          currentQualifier.attrValue += c;
          state = VALUE;
          break;

        case VALUE:
          if (c.match(WHITESPACE)) {
            state = ATTR_QUAL_END;
            break;
          }
          if (c == ']') {
            state = QUALIFIER;
            break;
          }
          if (c == "'" || c == '"')
            throw Error(SYNTAX_ERROR);

          currentQualifier.attrValue += c;
          break;

        case QUOTED_VALUE:
          if (c == valueQuoteChar) {
            state = ATTR_QUAL_END;
            break;
          }

          currentQualifier.attrValue += c;
          break;

        case SELECTOR_SEPARATOR:
          if (c.match(WHITESPACE))
            break;

          if (c == ',') {
            state = SELECTOR;
            break
          }

          throw Error(SYNTAX_ERROR);
      }
    }

    switch (state) {
      case SELECTOR:
      case TAG_NAME:
      case QUALIFIER:
      case QUALIFIER_NAME:
      case SELECTOR_SEPARATOR:
        // Valid end states.
        newSelector();
        break;
      default:
        throw Error(SYNTAX_ERROR);
    }

    if (!selectors.length)
      throw Error(SYNTAX_ERROR);

    return selectors;
  }
}

var attributeFilterPattern = /^([a-zA-Z:_]+[a-zA-Z0-9_\-:\.]*)$/;

function validateAttribute(attribute:string) {
  if (typeof attribute != 'string')
    throw Error('Invalid request opion. attribute must be a non-zero length string.');

  attribute = attribute.trim();

  if (!attribute)
    throw Error('Invalid request opion. attribute must be a non-zero length string.');


  if (!attribute.match(attributeFilterPattern))
    throw Error('Invalid request option. invalid attribute name: ' + attribute);

  return attribute;
}

function validateElementAttributes(attribs:string):string[] {
  if (!attribs.trim().length)
    throw Error('Invalid request option: elementAttributes must contain at least one attribute.');

  var lowerAttributes = {};
  var attributes = {};

  var tokens = attribs.split(/\s+/);
  for (var i = 0; i < tokens.length; i++) {
    var name = tokens[i];
    if (!name)
      continue;

    var name = validateAttribute(name);
    var nameLower = name.toLowerCase();
    if (lowerAttributes[nameLower])
      throw Error('Invalid request option: observing multiple case variations of the same attribute is not supported.');

    attributes[name] = true;
    lowerAttributes[nameLower] = true;
  }

  return Object.keys(attributes);
}



function elementFilterAttributes(selectors:Selector[]):string[] {
  var attributes:StringMap<boolean> = {};

  selectors.forEach((selector) => {
    selector.qualifiers.forEach((qualifier) => {
      attributes[qualifier.attrName] = true;
    });
  });

  return Object.keys(attributes);
}

interface Query {
  element?:string;
  attribute?:string;
  all?:boolean;
  characterData?:boolean;
  elementAttributes?:string;
  attributeList?:string[];
  elementFilter?:Selector[];
}

interface Options {
  callback:(summaries:Summary[]) => any;
  queries: Query[];
  rootNode?:Node;
  oldPreviousSibling?:boolean;
  observeOwnChanges?:boolean;
}

class MutationSummary {

  public static NodeMap = NodeMap; // exposed for use in TreeMirror.
  public static parseElementFilter = Selector.parseSelectors; // exposed for testing.

  public static createQueryValidator:(root:Node, query:Query)=>any;
  private connected:boolean;
  private options:Options;
  private observer:MutationObserver;
  private observerOptions:MutationObserverInit;
  private root:Node;
  private callback:(summaries:Summary[])=>any;
  private elementFilter:Selector[];
  private calcReordered:boolean;
  private queryValidators:any[];

  private static optionKeys:StringMap<boolean> = {
    'callback': true, // required
    'queries': true,  // required
    'rootNode': true,
    'oldPreviousSibling': true,
    'observeOwnChanges': true
  };

  private static createObserverOptions(queries:Query[]):MutationObserverInit {
    var observerOptions:MutationObserverInit = {
      childList: true,
      subtree: true
    };

    var attributeFilter:StringMap<boolean>;
    function observeAttributes(attributes?:string[]) {
      if (observerOptions.attributes && !attributeFilter)
        return; // already observing all.

      observerOptions.attributes = true;
      observerOptions.attributeOldValue = true;

      if (!attributes) {
        // observe all.
        attributeFilter = undefined;
        return;
      }

      // add to observed.
      attributeFilter = attributeFilter || {};
      attributes.forEach((attribute) => {
        attributeFilter[attribute] = true;
        attributeFilter[attribute.toLowerCase()] = true;
      });
    }

    queries.forEach((query) => {
      if (query.characterData) {
        observerOptions.characterData = true;
        observerOptions.characterDataOldValue = true;
        return;
      }

      if (query.all) {
        observeAttributes();
        observerOptions.characterData = true;
        observerOptions.characterDataOldValue = true;
        return;
      }

      if (query.attribute) {
        observeAttributes([query.attribute.trim()]);
        return;
      }

      var attributes = elementFilterAttributes(query.elementFilter).concat(query.attributeList || []);
      if (attributes.length)
        observeAttributes(attributes);
    });

    if (attributeFilter)
      observerOptions.attributeFilter = Object.keys(attributeFilter);

    return observerOptions;
  }

  private static validateOptions(options:Options):Options {
    for (var prop in options) {
      if (!(prop in MutationSummary.optionKeys))
        throw Error('Invalid option: ' + prop);
    }

    if (typeof options.callback !== 'function')
      throw Error('Invalid options: callback is required and must be a function');

    if (!options.queries || !options.queries.length)
      throw Error('Invalid options: queries must contain at least one query request object.');

    var opts:Options = {
      callback: options.callback,
      rootNode: options.rootNode || document,
      observeOwnChanges: !!options.observeOwnChanges,
      oldPreviousSibling: !!options.oldPreviousSibling,
      queries: []
    };

    for (var i = 0; i < options.queries.length; i++) {
      var request = options.queries[i];

      // all
      if (request.all) {
        if (Object.keys(request).length > 1)
          throw Error('Invalid request option. all has no options.');

        opts.queries.push({all: true});
        continue;
      }

      // attribute
      if ('attribute' in request) {
        var query:Query = {
          attribute: validateAttribute(request.attribute)
        };

        query.elementFilter = Selector.parseSelectors('*[' + query.attribute + ']');

        if (Object.keys(request).length > 1)
          throw Error('Invalid request option. attribute has no options.');

        opts.queries.push(query);
        continue;
      }

      // element
      if ('element' in request) {
        var requestOptionCount = Object.keys(request).length;
        var query:Query = {
          element: request.element,
          elementFilter: Selector.parseSelectors(request.element)
        };

        if (request.hasOwnProperty('elementAttributes')) {
          query.attributeList = validateElementAttributes(request.elementAttributes);
          requestOptionCount--;
        }

        if (requestOptionCount > 1)
          throw Error('Invalid request option. element only allows elementAttributes option.');

        opts.queries.push(query);
        continue;
      }

      // characterData
      if (request.characterData) {
        if (Object.keys(request).length > 1)
          throw Error('Invalid request option. characterData has no options.');

        opts.queries.push({ characterData: true });
        continue;
      }

      throw Error('Invalid request option. Unknown query request.');
    }

    return opts;
  }

  private createSummaries(mutations:MutationRecord[]):Summary[] {
    if (!mutations || !mutations.length)
      return [];

    var projection = new MutationProjection(this.root, mutations, this.elementFilter, this.calcReordered, this.options.oldPreviousSibling);

    var summaries:Summary[] = [];
    for (var i = 0; i < this.options.queries.length; i++) {
      summaries.push(new Summary(projection, this.options.queries[i]));
    }

    return summaries;
  }

  private checkpointQueryValidators() {
    this.queryValidators.forEach((validator) => {
      if (validator)
        validator.recordPreviousState();
    });
  }

  private runQueryValidators(summaries:Summary[]) {
    this.queryValidators.forEach((validator, index) => {
      if (validator)
        validator.validate(summaries[index]);
    });
  }

  private changesToReport(summaries:Summary[]):boolean {
    return summaries.some((summary) => {
      var summaryProps =  ['added', 'removed', 'reordered', 'reparented',
        'valueChanged', 'characterDataChanged'];
      if (summaryProps.some(function(prop) { return summary[prop] && summary[prop].length; }))
        return true;

      if (summary.attributeChanged) {
        var attrNames = Object.keys(summary.attributeChanged);
        var attrsChanged = attrNames.some((attrName) => {
          return !!summary.attributeChanged[attrName].length
        });
        if (attrsChanged)
          return true;
      }
      return false;
    });
  }

  constructor(opts:Options) {
    this.connected = false;
    this.options = MutationSummary.validateOptions(opts);
    this.observerOptions = MutationSummary.createObserverOptions(this.options.queries);
    this.root = this.options.rootNode;
    this.callback = this.options.callback;

    this.elementFilter = Array.prototype.concat.apply([], this.options.queries.map((query) => {
      return query.elementFilter ? query.elementFilter : [];
    }));
    if (!this.elementFilter.length)
      this.elementFilter = undefined;

    this.calcReordered = this.options.queries.some((query) => {
      return query.all;
    });

    this.queryValidators = []; // TODO(rafaelw): Shouldn't always define this.
    if (MutationSummary.createQueryValidator) {
      this.queryValidators = this.options.queries.map((query) => {
        return MutationSummary.createQueryValidator(this.root, query);
      });
    }

    this.observer = new MutationObserverCtor((mutations:MutationRecord[]) => {
      this.observerCallback(mutations);
    });

    this.reconnect();
  }

  private observerCallback(mutations:MutationRecord[]) {
    if (!this.options.observeOwnChanges)
      this.observer.disconnect();

    var summaries = this.createSummaries(mutations);
    this.runQueryValidators(summaries);

    if (this.options.observeOwnChanges)
      this.checkpointQueryValidators();

    if (this.changesToReport(summaries))
      this.callback(summaries);

    // disconnect() may have been called during the callback.
    if (!this.options.observeOwnChanges && this.connected) {
      this.checkpointQueryValidators();
      this.observer.observe(this.root, this.observerOptions);
    }
  }

  reconnect() {
    if (this.connected)
      throw Error('Already connected');

    this.observer.observe(this.root, this.observerOptions);
    this.connected = true;
    this.checkpointQueryValidators();
  }

  takeSummaries():Summary[] {
    if (!this.connected)
      throw Error('Not connected');

    var summaries = this.createSummaries(this.observer.takeRecords());
    return this.changesToReport(summaries) ? summaries : undefined;
  }

  disconnect():Summary[] {
    var summaries = this.takeSummaries();
    this.observer.disconnect();
    this.connected = false;
    return summaries;
  }
}

