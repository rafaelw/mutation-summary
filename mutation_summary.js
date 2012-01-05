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

(function() {

  // NodeMap UtilityClass. Exposed as MutationSummary.NodeMap.
  // TODO(rafaelw): Consider using Harmony Map when available.

  var ID_PROP = '__mutation-summary_node-map-id__';
  var nextId_ = 1;

  function ensureId(node) {
    if (!node[ID_PROP]) {
      node[ID_PROP] = nextId_++;
      return true;
    }

    return false;
  }

  function NodeMap() {
    this.map_ = {};
  };

  NodeMap.prototype = {
    set: function(node, value) {
      ensureId(node);
      this.map_[node[ID_PROP]] = { k: node, v: value};
    },
    get: function(node) {
      if (ensureId(node))
        return;
      var byId = this.map_[node[ID_PROP]];
      if (byId)
        return byId.v;
    },
    has: function(node) {
      return !ensureId(node) && node[ID_PROP] in this.map_;
    },
    'delete': function(node) {
      if (ensureId(node))
        return;
      delete this.map_[node[ID_PROP]];
    },
    keys: function() {
      var nodes = [];
      for (var id in this.map_) {
        nodes.push(this.map_[id].k);
      }
      return nodes;
    }
  };

  // Reachability & Matchability changeType constants.
  var STAYED_OUT = 0;
  var ENTERED = 1;
  var STAYED_IN = 2;
  var EXITED = 3;

  var reachableMatchableProduct = [
   /* STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED                      */
    [ STAYED_OUT,  STAYED_OUT,  STAYED_OUT,  STAYED_OUT ], /* STAYED_OUT */
    [ STAYED_OUT,  ENTERED,     ENTERED,     STAYED_OUT ], /* ENTERED    */
    [ STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED     ], /* STAYED_IN  */
    [ STAYED_OUT,  STAYED_OUT,  EXITED,      EXITED     ]  /* EXITED     */
  ];

  function enteredOrExited(changeType) {
    return changeType == ENTERED || changeType == EXITED;
  }

  var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

  function MutationProjection(rootNode) {
    this.rootNode = rootNode;
  }

  MutationProjection.prototype = {
    processMutations: function(mutations) {
      this.mutations = mutations;

      var self = this;
      this.changeMap = new NodeMap;

      function getChange(node) {
        var change = self.changeMap.get(node);
        if (!change) {
          change = {
            target: node
          };
          self.changeMap.set(node, change);
        }

        return change;
      }

      function getParentChange(node) {
        var change = getChange(node);
        if (!change.childList) {
          change.childList = true;
          change.oldParentNode = null;
        }

        return change;
      }

      function handleChildList(mutation) {
        self.childListChanges = true;

        forEach(mutation.removedNodes, function(el) {
          var change = getParentChange(el);

          if (change.added || change.oldParentNode)
            change.added = false;
          else
            change.oldParentNode = mutation.target;
        });

        forEach(mutation.addedNodes, function(el) {
          var change = getParentChange(el);
          change.added = true;
        });
      }

      function handleAttributes(mutation) {
        self.attributesChanges = true;

        var change = getChange(mutation.target);
        if (!change.attributes) {
          change.attributes = true;
          change.attributeOldValues = {};
        }

        var oldValues = change.attributeOldValues;
        if (!oldValues.hasOwnProperty(mutation.attributeName)) {
          oldValues[mutation.attributeName] = mutation.oldValue;
        }
      }

      function handleCharacterData(mutation) {
        self.characterDataChanges = true;

        var change = getChange(mutation.target);
        if (change.characterData)
          return;
        change.characterData = true;
        change.characterDataOldValue = mutation.oldValue;
      }

      this.mutations.forEach(function(mutation) {
        switch(mutation.type) {
          case 'childList':
            handleChildList(mutation);
            break;
          case 'attributes':
            handleAttributes(mutation);
            break;
          case 'characterData':
            handleCharacterData(mutation);
            break;
        }
      });
    },

    getChanged: function(added, removed, reparented, reordered) {
      if (!this.childListChanges && !this.attributesChanges)
        return; // No childList or attributes mutations occurred.

      var reachabilityChange = this.reachabilityChange.bind(this);
      var matchabilityChange = this.matchabilityChange.bind(this);
      var wasReordered = this.wasReordered.bind(this);

      var visited = new NodeMap;
      var self = this;

      function visitNode(node, parentReachable) {
        if (visited.has(node))
          return;
        visited.set(node, true);

        var change = self.changeMap.get(node);
        var reachable = parentReachable;

        if ((change && change.childList) || reachable == undefined)
          reachable = reachabilityChange(node);

        var recurse = reachable == ENTERED || reachable == EXITED;

        if (!recurse && change && !change.attributes && !change.childList)
          return; // Don't need to process characterData-only changes

        var matchable = matchabilityChange(node);

        var action = reachableMatchableProduct[reachable][matchable];
        if (action == ENTERED && added)
          added.push(node);

        if (action == EXITED && removed)
          removed.push(node);

        if (action == STAYED_IN && change) {
          if (reparented && change.oldParentNode !== node.parentNode)
            reparented.push(node);
          else if (reordered && wasReordered(node))
            reordered.push(node);
        }

        if (!recurse)
          return;

        for (var child = node.firstChild; child; child = child.nextSibling) {
          visitNode(child, reachable);
        }
      }

      var changedNodes = this.changeMap.keys();
      for (var i = 0; i < changedNodes.length; i++)
        visitNode(changedNodes[i]);
    },

    getAttributesChanged: function() {
      if (!this.attributesChanges)
        return []; // No attributes mutations occurred.

      var elements = this.changeMap.keys();
      var result = [];
      for (var i = 0; i < elements.length; i++) {
        var target = elements[i];
        if (STAYED_IN != this.reachabilityChange(target) || STAYED_IN != this.matchabilityChange(target))
          continue;

        var change = this.changeMap.get(target);
        var attributes = change.attributeOldValues;
        if (!attributes)
          continue;

        var anyChanged = false;
        change.attributeOldValues = {};

        Object.keys(attributes).forEach(function(name) {
          if (change.target.getAttribute(name) != attributes[name]) {
            change.attributeOldValues[name] = attributes[name];
            anyChanged = true;
          }
        });

        if (anyChanged)
          result.push({
            target: change.target,
            attributes: change.attributeOldValues
          });
      }

      return result;
    },

    getCharacterDataChanged: function() {
      if (!this.characterDataChanges)
        return []; // No characterData mutations occurred.

      var nodes = this.changeMap.keys();
      var result = [];
      for (var i = 0; i < nodes.length; i++) {
        var target = nodes[i];
        if (STAYED_IN != this.reachabilityChange(target) || STAYED_IN != this.matchabilityChange(target))
          continue;

        var change = this.changeMap.get(target);
        if (change.characterData &&
            target.textContent != change.characterDataOldValue)
          result.push({
            target: change.target,
            oldValue: change.characterDataOldValue
          });
      }

      return result;
    },

    /**
     * Returns whether a given node:
     *
     *    STAYED_OUT, ENTERED, STAYED_IN or EXITED
     *
     * the set of nodes reachable from the root.
     *
     * These four states are the permutations of whether the node
     *
     *   wasReachable(node)
     *   isReachable(node)
     *
     *
     * Complexity: O(log n)
     *   n: The number of nodes in the fragment.
     */
    reachabilityChange: function(el) {
      this.reachableCache = this.reachableCache || new NodeMap;
      this.wasReachableCache = this.wasReachableCache || new NodeMap;

      // Close over owned values.
      var rootNode = this.rootNode;
      var changeMap = this.changeMap;
      var reachableCache = this.reachableCache;
      var wasReachableCache = this.wasReachableCache;

      // An node's oldParent is
      //   -its present parent, if nothing happened to it
      //   -null if the first thing that happened to it was an add.
      //   -the node it was removed from if the first thing that happened to it
      //      was a remove.
      function getOldParent(el) {
        var change = changeMap.get(el);

        if (change && change.childList) {
          if (change.oldParentNode)
            return change.oldParentNode;
          if (change.added)
            return null;
        }

        return el.parentNode;
      }

      // Is the given node reachable from the rootNode.
      function getIsReachable(el) {
        if (el === rootNode)
          return true;
        if (!el)
          return false;

        var isReachable = reachableCache.get(el);
        if (isReachable === undefined) {
          isReachable = getIsReachable(el.parentNode);
          reachableCache.set(el, isReachable);
        }
        return isReachable;
      }

      // Was the given node reachable from the rootNode.
      // A node wasReachable if its oldParent wasReachable.
      function getWasReachable(el) {
        if (el === rootNode)
          return true;
        if (!el)
          return false;

        var wasReachable = wasReachableCache.get(el);
        if (wasReachable === undefined) {
          wasReachable = getWasReachable(getOldParent(el));
          wasReachableCache.set(el, wasReachable);
        }
        return wasReachable;
      }

      if (getIsReachable(el))
        return getWasReachable(el) ? STAYED_IN : ENTERED;
      else
        return getWasReachable(el) ? EXITED : STAYED_OUT;
    },

    /**
     * Returns whether a given element:
     *
     *   STAYED_OUT, ENTERED, EXITED or STAYED_IN
     *
     * the set of element which match at least one match pattern.
     *
     * These four states are the permutations of whether the element
     *
     *   wasMatching(el)
     *   isMatching(el)
     *
     *
     * Complexity: O(1)
     */
    matchabilityChange: function(el) {
      if (!this.elementFilter)
        return STAYED_IN;

      var attributeOldValues;
      var change = this.changeMap.get(el);
      if (change && change.attributeOldValues)
        attributeOldValues = change.attributeOldValues;
      else
        attributeOldValues = {};

      function checkMatch(filter, attrValue) {
        return (filter.tagName == '*' || filter.tagName == el.tagName) &&
               (!filter.attrName ||
                 (attrValue != null &&
                   (!filter.hasOwnProperty('attrValue') ||
                     filter.attrValue == attrValue)))
      }

      function getIsMatching(filter) {
        return checkMatch(filter, el.getAttribute(filter.attrName));
      }

      function getWasMatching(filter) {
        var attrValue = attributeOldValues[filter.attrName];
        if (attrValue === undefined)
          attrValue = el.getAttribute(filter.attrName);

        return checkMatch(filter, attrValue);
      }

      var isMatching = this.elementFilter.some(getIsMatching);
      var wasMatching = this.elementFilter.some(getWasMatching);

      if (isMatching)
        return wasMatching ? STAYED_IN : ENTERED;
      else
        return wasMatching ? EXITED : STAYED_OUT;
    },

    /**
     * Preprocessing step required for getReordered. This builds a set of
     * records, one for each parent which had nodes removed or added, and builds
     *   -A map of the nodes which were added
     *   -A map of the nodes which were removed
     *   -A map of the nodes which were "maybe moved" (removed and added back).
     *   -A map of node->old previous node (the previousSibling of the node when
     *    observation)
     *
     * Complexity: O(a)
     *   a: The number of node removals and additions which have occurred.
     *
     * See getReordered, below.
     */
    processChildlistChanges: function() {
      if (this.childlistChanges)
        return;

      var childlistChanges = this.childlistChanges = new NodeMap;

      function getChildlistChange(el) {
        var change = childlistChanges.get(el);
        if (!change) {
          change = {
            added: new NodeMap,
            removed: new NodeMap,
            maybeMoved: new NodeMap,
            oldPrevious: new NodeMap
          };
          childlistChanges.set(el, change);
        }

        return change;
      }

      var reachabilityChange = this.reachabilityChange.bind(this);

      this.mutations.forEach(function(mutation) {
        if (mutation.type != 'childList')
          return;

        if (reachabilityChange(mutation.target) != STAYED_IN)
          return;

        var change = getChildlistChange(mutation.target);

        var oldPrevious = mutation.previousSibling;

        function recordOldPrevious(node, previous) {
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

        forEach(mutation.removedNodes, function(node) {
          recordOldPrevious(node, oldPrevious);

          if (change.added.has(node)) {
            change.added.delete(node);
          } else {
            change.removed.set(node, true);
            change.maybeMoved.delete(node, true);
          }

          oldPrevious = node;
        });

        recordOldPrevious(mutation.nextSibling, oldPrevious);

        forEach(mutation.addedNodes, function(node) {
          if (change.removed.has(node)) {
            change.removed.delete(node);
            change.maybeMoved.set(node, true);
          } else {
            change.added.set(node, true);
          }
        });
      });
    },

    wasReordered: function(node) {
      if (!this.childListChanges)
        return false;

      this.processChildlistChanges();

      var change = this.childlistChanges.get(node.parentNode);
      if (change.moved)
        return change.moved.get(node);

      var moved = change.moved = new NodeMap;
      var pendingMoveDecision = new NodeMap;

      function isFirstOfPending(node) {
        // Ensure that the result is deterministic.
        while (node = node.previousSibling) {
          if (pendingMoveDecision.has(node))
            return false;
        }

        return true;
      }

      function isMoved(node) {
        if (!node)
          return false;
        if (!change.maybeMoved.has(node))
          return false;

        var didMove = moved.get(node);
        if (didMove !== undefined)
          return didMove;

        if (pendingMoveDecision.has(node)) {
          didMove = isFirstOfPending(node);
        } else {
          pendingMoveDecision.set(node, true);
          didMove = getPrevious(node) !== getOldPrevious(node);
        }

        if (pendingMoveDecision.has(node)) {
          pendingMoveDecision.delete(node);
          moved.set(node, didMove);
        } else {
          didMove = moved.get(node);
        }

        return didMove;
      }

      var oldPreviousCache = new NodeMap;
      function getOldPrevious(node) {
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

      var previousCache = new NodeMap;
      function getPrevious(node) {
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

  function validateOptions(options) {
    // TODO(rafaelw): Implement
    return options;
  }

  var validNamePart = '[a-zA-Z:_]+[a-zA-Z0-9_\\-:\\.]*';
  var textPart = '[^\\]^=]*';

  var elementFilterPattern = new RegExp('^(' + validNamePart + ')' +
                                        '(\\[(' + validNamePart + ')' +
                                          '(=(' + textPart + ')){0,1}' +
                                        '\\]){0,1}$');

  function parseElementFilters(filters) {
    var copy = filters.concat();
    filters.length = 0;
    var attributes = {};

    for (var i = 0; i < copy.length; i++) {
      var text = copy[i];
      var matches = text.match(elementFilterPattern);
      if (!matches)
        throw Error('Invalid elementFilter syntax');

      var filter = {
        tagName: matches[1].toUpperCase()
      };

      if (matches[2]) {
        filter.attrName = matches[3];
        attributes[filter.attrName] = true;
        if (matches[4])
          filter.attrValue = matches[5];
      }
      filters.push(filter);
    }

    return Object.keys(attributes);
  }

  function createObserverOptions(options) {
    var observerOptions = {
      subtree: true
    }

    var elementFilterObservedAttributes = [];
    if (options.childList) {
      observerOptions.childList = true;

      if (options.elementFilter) {
        elementFilterObservedAttributes = parseElementFilters(options.elementFilter);
      }
    }

    if (options.attributes || elementFilterObservedAttributes.length) {
      observerOptions.attributes = true;
      observerOptions.attributeOldValue = true;

      var attributeFilter = options.attributeFilter && options.attributeFilter.length ?
          options.attributeFilter : []; elementFilterObservedAttributes;

      attributeFilter = attributeFilter.concat(elementFilterObservedAttributes);

      if (attributeFilter.length)
        observerOptions.attributeFilter = attributeFilter;
    }

    if (options.characterData) {
      observerOptions.characterData = true;
      observerOptions.characterDataOldValue = true;
    }

    return observerOptions;
  }

  function createSummary(mutations, root, options) {
    var projection = new MutationProjection(root);
    projection.processMutations(mutations);

    var summary = {
      target: root,
      type: 'summary'
    };

    if (options.childList) {
      projection.elementFilter = options.elementFilter;

      var added = [];
      var removed = [];
      var reparented = [];
      var reordered = [];

      projection.getChanged(added, removed, reparented, reordered);

      summary.added = added;
      summary.removed = removed;
      summary.reparented = reparented;

      if (options.reordered)
        summary.reordered = reordered;
    }

    if (options.attributes) {
      summary.attributes = projection.getAttributesChanged();
    }

    if (options.characterData) {
      summary.characterData = projection.getCharacterDataChanged();
    };

    return summary;
  }

  function MutationSummary(opts) {
    var options = validateOptions(opts);
    var observerOptions = createObserverOptions(options);

    var root = options.rootNode || document;
    var callback = options.callback;

    var observer = new WebKitMutationObserver(function(mutations) {
      if (!options.observeOwnChanges) {
        observer.disconnect();
      }

      callback(createSummary(mutations, root, options));

      if (!options.observeOwnChanges) {
        observer.observe(root, observerOptions);
      }
    });

    observer.observe(root, observerOptions);

    this.disconnect = function() {
      observer.disconnect();
    };
  }

  // Externs
  this.MutationSummary = MutationSummary;
  this.MutationSummary.NodeMap = NodeMap;
})();
