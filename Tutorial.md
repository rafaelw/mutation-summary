# Mutation Summary Tutorial #

This document is a tutorial that describes how to use the Mutation Summary library to watch a web page for various kinds of changes.

Other resources:
  * A [high-level overview](https://github.com/rafaelw/mutation-summary) of what this library is, how it can help you, and the new [DOM Mutation Observers](http://dvcs.w3.org/hg/domcore/raw-file/tip/Overview.html#mutation-observers) browser API on which it depends.
  * The MutationSummary [API reference](APIReference.md) document.

# Observing a single attribute #

Let’s start with a contrived use case that illustrates the basics of using Mutation Summary: An imaginary micro-format, called “hTweet”. The purpose of hTweet is so that page authors can annotate any section of their pages with a hash-tag that is most-likely relevant, like so:

```
<span data-h-tweet=”#beiber”>Isn’t Justin dreamy?</span>
```

Now, we want to build an extension that can detect these hTweets and create links to Twitter, or maybe display a pop-up tweet-input-field when the mouse hovers over them that's pre-filled with the hash tag.

Our extension probably wants to know when:
  1. New elements with the `data-h-tweet` attribute have appeared in the page
  1. The value of the `data-h-tweet` attribute on an element we already know about has changed, and possibly what the old value was.
  1. Elements that had the `data-h-tweet` attribute have left the page.

In order to do this, we’d create a `MutationSummary` object like this:

```
var observer = new MutationSummary({
  callback: handleHTweetChanges,
  queries: [{ attribute: 'data-h-tweet' }]
});
```

This creates a new `MutationSummary` that begins observing the entire document immediately. `MutationSummary` requires only two things to work: the function to call when it has changes to report, and [at least one “query”](APIReference.md#configuration-options) of what it should be watching for. In this case, we’re only asking for a single [attribute query](APIReference.md#the-attribute-query) and giving it the name of the attribute we’re looking for.

Now, whenever any of the above three things have happened, `MutationSummary` will invoke our `handleHTweetChanges` and pass as the only argument an array containing a summary of changes for each query that was requested. We might implement `handleHTweetChanges` like this:

```
function handleHTweetChanges(summaries) {
  var hTweetSummary = summaries[0];

  hTweetSummary.added.forEach(function(newEl) {
    // do setup work on new elements with data-h-tweet
  });

  hTweetSummary.valueChanged.forEach(function(changeEl) {
    var oldValue = hTweetChanges.getOldAttribute(changeEl);
    var currentValue = changeEl.getAttribute(‘data-h-tweet’);
    // handle value changed.
  });

  hTweetSummary.removed.forEach(function(removedEl) {
    // do tear-down or cleanup work for elements that had    
    // data-h-tweet.
  });
}
```

A couple things to note at this point:
  * **What Mutation Summary reports will always be true from its callback’s point of view.** For example, if some code changed an `data-h-tweet` attribute from ‘#beiber” to ‘#gaga’ and then some other code changed it back to ‘#beiber’ by the time our callback is invoked, Mutation Summary won’t bother telling us about the change, because from our point of view there isn’t one.
  * **Mutation Summary defaults to observing the entire document of the main window.** If we had wanted to only observe a portion we could have used the [rootNode](APIReference.md#configuration-options) option.
  * **Mutation Summary will ignore changes that are made during the course of its `callback`.** For example, if `added` contained an element with “#biber” and our extension decides that it should be “#beiber”, then the next time Mutation Summary invokes `handleHTweetChanges`, it will not report the change from ‘#biber’ to ‘#beiber’. Want to hear about something that you did? You probably don’t--but if you do, you can set [observeOwnChanges](APIReference.md#configuration-options) to true.

# Observing elements and attributes on those elements #

Let's look at another hypothetical example inspired by the requirements of real-world widget libraries like Dojo Widgets. Let’s say we’re creating a UI widget library that allows its widgets to be declared and configured in HTML:

```
<div data-widget=”fancyButton”   
     data-widget-theme=”midnight”>Click Me!</div>
```

Our library will probably want to look for all such elements in the page when it loads by listening to the `DOMContentLoaded` event, doing a `querySelectorAll(“*[data-widget]”)` and setting them all up.

But our library also wants to respond to new widgets that appear in the page, possibly created by script or a templating library. In order to accomplish this, we’d create an [element query](APIReference.md#the-element-query) like this:

```
var observer = new MutationSummary({
  callback: updateWidgets,
  queries: [{
    element: '[data-widget]'
  }]
});
```

Here's what the `updateWidgets` function might look like:

```
function updateWidgets(summaries) {
  var widgetSummary = summaries[0];
  widgetSummary.added.forEach(buildNewWidget);
  widgetSummary.removed.forEach(cleanupExistingWidget);
}
```

The [element query](APIReference.md#the-element-query) instructs the `MutationSummary` to watch for particular elements. The contents of the `element` string can be a [very simple subset of CSS](APIReference.md#supported-selector-syntax). This allows you to watch literal elements or do something more complex, as in this example.

But doesn’t our widget library also want to respond correctly when an existing widget changes its type or theme? It does, and it can:

```
var observer = new MutationSummary({
  callback: updateWidgets,
  queries: [{
    element: '[data-widget]',
    elementAttributes: 'data-widget data-widget-theme'
  }]
});
```

The optional `elementAttributes` property is just a space-separated list of attribute names and it asks the `MutationSummary` to report changes to the value of those attributes on elements matching the element string that have stayed in the document. Now our `updateWidgets` might look like this:

```
function updateWidgets(summaries) {
  var widgetSummary = summaries[0];
  widgetSummary.added.forEach(buildNewWidget);
  widgetSummary.removed.forEach(cleanupExistingWidget);

  var changedType = widgetSummary.attributeChanged[‘data-widget’];
  var changedTheme = widgetSummary.attributeChanged[‘data-widget-theme];
  changeWidgetTypeOrTheme(changedType, changedTheme);
}
```

Let’s add one more complication: Say our widget library also allows in-line handling of events that its widgets can emit via a script element with a special type attribute:

```
<div data-widget=”autocomplete”>
  <script type=”widget/event-handler” data-event=”selectionMade”>
    // Handle the user navigating over a autocomplete suggestion
    // and pressing return or clicking.
  </script>
</div>
```

Now our widget library wants to listen to two distinct kinds of things. Mutation Summary allows this by supporting multiple queries:

```
var observer = new MutationSummary({
  callback: updateWidgets,
  queries: [{
    element: '*[data-widget]',
    elementAttributes: ‘data-widget data-widget-theme’
  },{
    element: 'script[type=”widget/event-handler”]',
    elementAttributes: ‘data-event’
  }]
});
```

and our handler would now look like this:

```
function updateWidget(summaries) {
  var widgetSummary = summaries[0];
  var scriptHandlerSummary = summaries[1];

  // update widgets and also hook up event handlers...
}
```

At this point you may ask: “what’s the advantage of using multiple queries within a single `MutationSummary` object vs. creating multiple `MutationSummary` objects?” Isn’t it more convenient to just have two `MutationSummary` objects, each with its own callback? It might seem so, but it’s best not to.

It’s best to have one `MutationSummary` for each [concern](http://en.wikipedia.org/wiki/Concern_(computer_science)). In practice, it’s almost always best to collect all your changes first then do all your work in response to those changes at once. If you were to create multiple `MutationSummary` objects for the same conceptual task, you’d be making the browser unnecessarily do nearly double the amount of work, and there’s the risk that your code might get confused because changes made by one `MutationSummary` will be reported to the others and vice-versa.

If your page uses multiple libraries that do different things (say a UI widget library and a templating library) -- it makes sense that each of those would use its own `MutationSummary`, but each probably only wants to use one.

# Learning More #

  * Refer to the [API Reference](APIReference.md) document -- in particular to learn about the two other types of queries: [characterData](APIReference.md#the-characterdata-query) and [all](APIReference.md#the-all-query).
  * Examine the [PageMirror](examples/pagemirror_extension) extension which shows how to use the all query and the included TreeMirror utility class to fully mirror the contents of a document.