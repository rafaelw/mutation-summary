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

    getChanged: function(summary) {
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
        if (action == ENTERED)
          summary.added.push(node);

        if (action == EXITED)
          summary.removed.push(node);

        if (action == STAYED_IN && change) {
          if (summary.reparented && change.oldParentNode !== node.parentNode)
            summary.reparented.push(node);
          else if (summary.reordered && wasReordered(node))
            summary.reordered.push(node);
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

    getAttributesChanged: function(postFilter) {
      if (!this.attributesChanges)
        return []; // No attributes mutations occurred.

      var attributeFilter;
      if (postFilter) {
        attributeFilter = {};
        postFilter.forEach(function(attrName) {
          attributeFilter[attrName] = true;
        });
      }

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
          if (attributeFilter && !attributeFilter[name])
            return;

          if (change.target.getAttribute(name) == attributes[name])
            return;

          change.attributeOldValues[name] = attributes[name];
          anyChanged = true;
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
    reachabilityChange: function(node) {
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
      function getOldParent(node) {
        var change = changeMap.get(node);

        if (change && change.childList) {
          if (change.oldParentNode)
            return change.oldParentNode;
          if (change.added)
            return null;
        }

        return node.parentNode;
      }

      // Is the given node reachable from the rootNode.
      function getIsReachable(node) {
        if (node === rootNode)
          return true;
        if (!node)
          return false;

        var isReachable = reachableCache.get(node);
        if (isReachable === undefined) {
          isReachable = getIsReachable(node.parentNode);
          reachableCache.set(node, isReachable);
        }
        return isReachable;
      }

      // Was the given node reachable from the rootNode.
      // A node wasReachable if its oldParent wasReachable.
      function getWasReachable(node) {
        if (node === rootNode)
          return true;
        if (!node)
          return false;

        var wasReachable = wasReachableCache.get(node);
        if (wasReachable === undefined) {
          wasReachable = getWasReachable(getOldParent(node));
          wasReachableCache.set(node, wasReachable);
        }
        return wasReachable;
      }

      if (getIsReachable(node))
        return getWasReachable(node) ? STAYED_IN : ENTERED;
      else
        return getWasReachable(node) ? EXITED : STAYED_OUT;
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
     *   wasMatching(node)
     *   isMatching(node)
     *
     *
     * Complexity: O(1)
     */
    matchabilityChange: function(node) {
      if (!this.elementFilter)
        return STAYED_IN;

      if (node.nodeType !== Node.ELEMENT_NODE)
        return STAYED_OUT;

      var el = node;
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

  var validNamePart = '[a-zA-Z:_]+[a-zA-Z0-9_\\-:\\.]*';
  var textPart = '.*';

  var attributeFilterPattern = new RegExp('^(' + validNamePart + ')$');

  var elementFilterPattern = new RegExp('^[\\W]*(' + validNamePart + ')' +
                                        '(\\[[\\W]*(' + validNamePart + ')' +
                                          '[\\W]*(=(' + textPart + ')){0,1}' +
                                        '\\]){0,1}$');

  function parseElementFilters(filters) {
    var syntaxError = Error('Invalid elementFilter syntax');

    function parseAttributeValue(text) {
      text = text.trim();
      if (!text.length)
        throw syntaxError;

      var quoteMatch = text.match(/\"(.*)\"/);
      if (!quoteMatch)
        quoteMatch = text.match(/\'(.*)\'/);
      if (quoteMatch)
        text = quoteMatch[1];

      return text;
    }

    if (!filters.length)
      throw Error('Invalid option: elementFilter must contain at least one item if specified');

    var copy = filters.concat();
    filters.length = 0;

    for (var i = 0; i < copy.length; i++) {
      var text = copy[i];
      var matches = text.match(elementFilterPattern);
      if (!matches)
        throw syntaxError;

      var filter = {
        tagName: matches[1].toUpperCase()
      };

      if (matches[2]) {
        filter.attrName = matches[3];
        if (matches[4])
          filter.attrValue = parseAttributeValue(matches[5]);
      }
      filters.push(filter);
    }
  }

  function validateAttributeFilters(filters) {
    if (!filters.length)
      throw Error('Invalid option: attributeFilter must contain at least one item if specified');

    for (var i = 0; i < filters.length; i++) {
      if (!filters[i].match(attributeFilterPattern))
        throw Error('Invalid option: invalid attribute name: ' + filters[i]);
    }
  }

  function validateOptions(options) {
    var validOptions = {
      'callback': true, // required
      'rootNode': true,
      'observeOwnChanges': true,
      'elementFilter': true,
      'reordered': true,
      'reparented': true,
      'attributes': true,
      'attributeFilter': true,
      'characterData': true
    };

    for (var opt in options) {
      if (!(opt in validOptions))
        throw Error('Invalid option: ' + opt);
    }

    if (typeof options.callback !== 'function')
      throw Error('Invalid options: callback is required and must be a function');

    if (options.attributeFilter && !options.attributes)
      throw Error('Invalid options: attributeFilter requires attributes');

    if (options.elementFilter)
      parseElementFilters(options.elementFilter);

    if (options.attributeFilter)
      validateAttributeFilters(options.attributeFilter);

    if (options.elementFilter && options.characterData)
      throw Error('Invalid options: elementFilter and characterData cannot be used together')

    return options;
  }

  function elementFilterAttributes(filters) {
    var attributes = {};

    filters.forEach(function(filter) {
      if (filter.attrName)
        attributes[filter.attrName] = true;
    });

    return Object.keys(attributes);
  }

  function createObserverOptions(options) {
    var observerOptions = {
      childList: true,
      subtree: true
    }

    var elementFilterObservedAttributes = [];
    if (options.elementFilter) {
      elementFilterObservedAttributes = elementFilterAttributes(options.elementFilter);
    }

    if (options.attributes || elementFilterObservedAttributes.length) {
      observerOptions.attributes = true;
      observerOptions.attributeOldValue = true;

      if (options.attributeFilter) {
        // If no filter is specified, then all attribute changes are reported. We only need to
        // include elementFilterObservedAttributes if attributeFilter is provided.
        observerOptions.attributeFilter = options.attributeFilter;

        if (elementFilterObservedAttributes.length) {
          options.postAttributeFilter = observerOptions.attributeFilter;
          observerOptions.attributeFilter =
              observerOptions.attributeFilter.concat(elementFilterObservedAttributes);
        }
      }
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
    projection.elementFilter = options.elementFilter;

    var summary = {
      target: root,
      type: 'summary',
      added: [],
      removed: [],
      reparented: options.reparented ? [] : undefined,
      reordered: options.reordered ? [] : undefined
    };

    projection.getChanged(summary);

    if (options.attributes)
      summary.attributes = projection.getAttributesChanged(options.postAttributeFilter);

    if (options.characterData)
      summary.characterData = projection.getCharacterDataChanged();

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
