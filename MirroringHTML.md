# Introduction #

There are multiple valid approaches to mirroring a tree using Mutation Observers. [TreeMirror](util/tree_mirror.js) trades off a small amount of memory so it can be fast to process changes. It maintains a mapping from local node to remote node, so that when it processes the `added`, `removed`, `reparented` & `reordered` node arrays, it can efficiently find the corresponding remote node by simply looking it up in the map.

# Details #

The general approach is this:
  * Maintain a mapping from localNode -> remoteNode. To do this, it uses the `MutationSummary.NodeMap` class, which exposes a simple `get()`, `has()`, `set()`, `delete()` API. For the rest of this API, I'll represent a corresponding remote node like this: `remoteNode(localNode)`.

For each summary of changes:
  * For each `node` in `removed` nodes
    1. Remove `remoteNode(node)` from its remote parent
    1. Remove `node`->`remoteNode(node)` from the mapping
  * For each `node` in `added`
    1. Create a new `remoteNode` and add `node` -> `remoteNode` to the mapping
  * For each `node` in `reparented` & `reordered`
    1. Remove `remoteNode(node)` from its remote parent
  * Create an array of `insertions` by concatenating `added`, `reparented` & `reordered`.
    1. Sort insertions first by `node.parentNode`, then by ascending order of `node.previousSibling`
    1. For each `node` in `insertion`
    1. insert `remoteNode(node)` as a child of `remoteNode(node.parentNode)` immediately after `remoteNode(node.previousSibling)`.

That's it. There's one non-obvious step here that's worth pointing out: it's necessary to remove all `reparented` & `reordered` nodes before inserting all `added`, `reparented` & `reordered` nodes to the new location because otherwise it's possible to create a cycle in the HTML structure (which is, of course, disallowed).