declare global {
  var WebKitMutationObserver: {
    prototype: MutationObserver;
    new(callback: MutationCallback): MutationObserver;
  };

  type WebKitMutationObserver = MutationObserver;
}

export { };
