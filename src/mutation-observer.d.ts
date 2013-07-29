// Type definitions for the DOM Mutation Observers API
// http://dom.spec.whatwg.org/#mutation-observers

interface MutationObserver {
  observe(node:Node, options:MutationObserverInit);
  takeRecords():MutationRecord[];
  disconnect();
}

interface MutationObserverInit {
  childList?:boolean;
  attributes?:boolean;
  characterData?:boolean;
  subtree?:boolean;
  attributeOldValue?:boolean;
  characterDataOldValue?:boolean;
  attributeFilter?:string[];
}

interface MutationRecord {
  type:string;
  target:Node;
  addedNodes:NodeList;
  removedNodes:NodeList;
  previousSibling:Node;
  nextSibling:Node;
  attributeName:string;
  attributeNamespace:string;
  oldValue:string;
}

declare var MutationObserver: {
  prototype: MutationObserver;
  new(callback:(records:MutationRecord[])=>any): MutationObserver;
}
