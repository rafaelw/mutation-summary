# Mutation Summary API Reference #

The Mutation Summary library exports a single JavaScript class of the same name: `MutationSummary`.

When created, it takes care of the details of observing the DOM for changes, computing the "net-effect" of what's changed and then delivers these changes to the provided callback.

# MutationSummary Constructor #

```
var observer = new MutationSummary({
  callback: handleChanges, // required
  rootNode: myDiv, // optional, defaults to window.document
  observeOwnChanges: // optional, defaults to false
  oldPreviousSibling: // optional, defaults to false
  queries: [
    { /* query1 */ },
    { /* query2 */ }, 
      // …
    { /* queryN */ }
  ]
});

// If/when change report callbacks are no longer desired
var summaries = observer.disconnect();
if (summaries)
  handleChangesUpToHere(summaries);
```

The `MutationSummary` begins observing immediately and will report changes starting from the time of its creation. It takes a single argument that is an object containing configuration properties.

## Configuration Options ##

  * **`callback`**. _Required_. A function which will be invoked when there are changes matching any of the requested `queries`.
  * **`rootNode`**. _Optional_. Defaults to `window.document`. The root of the sub-tree to observe.
  * **`observeOwnChanges`**. _Optional_. Defaults to `false`. Configures whether changes made during the course of  the `callback` invocation are observed for potential delivery in the next `callback` invocation.
  * **`oldPreviousSibling`**. _Optional_. Defaults to `false`. If true, `getOldPreviousSibling` can be called with nodes returned in `removed` and `reparented`.
  * **`queries`**. _Required_. A non-empty array of query request objects.

## Callback parameters ##

When `MutationSummary` has changes to report which match any of the requested `queries`, it will invoke the provided `callback` with a single argument which is an array of summary objects -- one for each request provided to the `queries` option parameter, in the order requested.

## Methods ##

  * **`takeSummaries`**. Immediately calculates changes and returns them as an array of summaries. If there are no changes to report, returns undefined.

  * **`disconnect`**. Discontinues observation immediately. If DOM changes are pending delivery, they will be fetched and reported as the same array of summaries which are handed into the callback. If there is nothing to report, this function returns `undefined`.

  * **`reconnect`**. Starts observation using an existing `MutationSummary` which has been disconnected. Note that this function is just a convenience method for creating a new `MutationSummary` with the same options. The next time changes are reported, they will relative to the state of the observed DOM at the point that `reconnect` was called.

# Query Types #

There are four types of Query objects:

  * **[attribute](#the-attribute-query)**
  * **[element](#the-element-query)**
  * **[characterData](#the-characterdata-query)**
  * **[all](#the-all-query)**

Each has a slightly different form and returns slightly different summary objects.

## The attribute Query ##

Summarize changes to the presence and value of the given attribute throughout the observed subtree.

### Request ###

```
{ attribute: <string> }
```

  * **`attribute`**. The name of a single attribute to observe throughout the subtree.

### Response ###

```
{
 added: [ array of <element> ],
 removed: [ array of <element> ],
 valueChanged: [ array of <element> ],
 getOldAttribute: function(element, attrName) { … },
 getOldParentNode: function(element) { ... }
}
```

  * **`added`**. All elements presently in the subtree and having the given attribute, but that
    1. Were not in the subtree.
    1. Lacked the given attribute.
    1. Both (1) & (2).
  * **`removed`**. All elements previously in the subtree and having the given attribute, but that now are
    1. Are not in the subtree
    1. Lack the given attribute
    1. Both (1) and (2).
  * **`valueChanged`**. All elements previously and presently in the subtree and previously and presently having the given attribute, for whom the value of the given attribute change.
  * **`getOldAttribute`**. a function which will retrieve the previous value of `attrName` for `element`. _element_ must be contained in the valueChanged element array. otherwise the function throws an error.
  * **`getOldParentNode`**. a function which will retrieve the previous parentNode for _element_. _element_ must be contained in the removed element array, otherwise the function throws an error.

## The element Query ##

Summarize the changes to the presence and location of the elements matching the given selector string, and (optionally) changes to the given set of attribute _of those elements_ throughout the observed subtree.

### Request ###

```
{
 element: <string>,
 elementAttributes: <string>, // optional
}
```

  * **`element`**. A “selector” string which describes what elements are to be observed.
  * **`elementAttributes`**. _Optional_. A space separated list of attributes to observe for value changes on the specified element.

#### Supported Selector Syntax ####

**_IMPORTANT_** The `element` selector string only supports a simple subset of CSS. The syntax it supports is: Groupings of simple-selectors, with no support for pseudo-element matching. To be clear, this means

**Supported**

| **Selector** | **Examples** |
| :----------- | :----------- |
| Type         | `“div”`, `“span”` |
| Universal    |  `“*”`, `"*[foo]"` |
| Class        | `“.myClass”`,  `“div.myClass”` |
| ID           | `“#myId”`, `“div#myId”` |
| Attribute    | `“[foo]”`, `“div[bar]”` |
| Attribute value matches | `“div[baz=bat]”`, `“span[foo=’bar baz’]"` |
| Attribute value matches white-space-separated substring | `“div[foo~=bar]”` |
| Groupings    | `“div, span[foo], .myClass”` |

**Unsupported**

| **Selector**    | **Examples** |
| :-------------- | :----------- |
| Pseudo-elements | `“div:first-child”`, `“a:hover”` |
| Attribute = value-match | `“div[foo|=bar]”` |
| Combinators     | `“div > span”`, `“div input”`, `“h1 + div”` |

### Response ###

```
{
 added: [ array of <element> ],
 removed: [ array of <element> ],
 reparented: [ array of <element> ],

 // Only present if elementAttributes specified
 attributeChanged: {
   attributeName1: [ array of <element> ],
   attributeName2: [ array of <element> ], ...
 },
 // Only present if elementAttributes specified
 getOldAttribute: function(element, attrName) { … },
 getOldParentNode: function(element) { ... }
}
```

  * **`added`**. All elements are presently in the subtree and match at least one pattern, but previously:
    1. Were not in the subtree.
    1. Matched zero patterns.
    1. Both (1) and (2).
  * **`removed`**. All elements were previously in the subtree and matched at least one pattern, but which now:
    1. Are not in the subtree
    1. Match zero patterns.
    1. Both (1) and (2).
  * **`reparented`**. All elements previously & presently in the subtree and previously & presently matching at least one pattern, which were moved to be children of a new parent (their present parentNode is distinct from the previous parentNode).
  * **`attributeChanged`**. _Optional (present only if `elementAttributes` was provided)_. An object reporting attribute value changes. The object contains one key for each attribute name contained in `elementAttributes`. The value of each key is an array of elements previously & presently in the subtree and previously & presently matching at least one pattern for whom the corresponding attribute changed value.
  * **`getOldAttribute`**. a function which will retrieve the previous value of `attrName` for `element`. _element_ must be contained in the `attrName` element array of `attributeChanged`, otherwise the function throws an error.
  * **`getOldParentNode`**. a function which will retrieve the previous parentNode for _element_. _element_ must be contained in the removed or reparented element arrays, otherwise the function throws an error.

## The characterData Query ##

Summarize the effective changes to the presence and value of characterData nodes in the observed subtree.

### Request ###

```
{ characterData: true }
```

### Response ###

```
{
 added: [ array of <node> ],
 removed: [ array of <node> ],
 reparented: [ array of <node> ],
 valueChanged: [ array of <node> ],
 getOldCharacterData: function(node) { … },
 getOldParentNode: function(node) { ... }
}
```

  * **`added`**. All character data nodes presently in the subtree, but previously were not in the subtree.
  * **`removed`**. All character data nodes previously in the subtree, which now are not in the subtree.
  * **`reparented`**. All character data nodes previously & presently in the subtree, which were moved to be children of a new parent (their present parentNode is distinct from the previous parentNode).
  * **`valueChanged`**. All character data nodes previously & presently whose value changed.
  * **`getOldCharacterData`**. a function which will retrieve the previous value of `node`. `node` must be  contained in the `valueChanged` node array, otherwise the function throws an error.
  * **`getOldParentNode`**. a function which will retrieve the previous parentNode for _node_. _node_ must be contained in the removed element array, otherwise the function throws an error.

## The all Query ##

Observe all changes to a given subtree

### Request ###

```
{ all: true }
```

### Response ###

```
{
 added: [ array of <node> ],
 removed: [ array of <node> ],
 reparented: [ array of <node> ],
 reordered: [ array of <node> ],
 attributeChanged: {
   attributeName1: [ array of <element> ],
   attributeName2: [ array of <element> ], ...
 },
 characterDataChanged: [array of <node>],
 getOldAttribute: function(element, attrName) { … },
 getOldCharaterData: function(node) { … },
 getOldParentNode: function(node) { ... },
 getOldPreviousSibling: function(node) { ... }
}
```

  * **`added`**. All nodes presently in the subtree, but previously were not in the subtree.
  * **`removed`**. All nodes previously in the subtree, which now are not in the subtree.
  * **`reparented`**. All nodes previously & presently in the subtree, which were moved to be children of a new parent (their present parentNode is distinct from the previous parentNode).
  * **`reordered`**. All nodes previously & presently in the subtree and previously & presently are children of the same parent, but have moved to a new location in their parentNode’s childList.
  * **`attributeChanged`**. An object reporting attribute value changes. The object contains one key for each attribute name contained in `elementAttributes`. The value of each key is an array of elements previously & presently in the subtree and previously & presently matching at least one pattern for whom the corresponding attribute changed value.
  * **`characterDataChanged`**. All characterData nodes previously & presently whose value changed.
  * **`getOldAttribute`**. a function which will retrieve the previous value of `attrName` for `element`. _element_ must be contained in the `attrName` element array of `attributeChanged`, otherwise the function throws an error.
  * **`getOldCharacterData`**. a function which will retrieve the previous value of `node`. `node` must be  contained in the `valueChanged` node array, otherwise the function throws an error.
  * **`getOldParentNode`**. a function which will retrieve the previous parentNode for _element_. _element_ must be contained in the removed or reparented element arrays, otherwise the function throws an error.
  * **`getOldPreviousSibling`**. a function which will retrieve the previous previousSibling for _node_. _node_ must be contained in the reordered element array, otherwise the function throws an error.
