# What is this? #

Mutation Summary is a JavaScript library that makes observing changes to the DOM fast, easy and safe.

It's built on top of (and requires) a new browser API called [DOM Mutation Observers](http://dom.spec.whatwg.org/#mutation-observers).

  * [Browsers which currently implement DOM Mutation Observers](DOMMutationObservers.md#browser-availability).
  * [DOM Mutation Observers API and its relationship to this library and (the deprecated) DOM Mutation Events](DOMMutationObservers.md).

<a href='http://www.youtube.com/watch?feature=player_embedded&v=eRZ4pO0gVWw' target='_blank'><img src='http://img.youtube.com/vi/eRZ4pO0gVWw/0.jpg' width='425' height=344 /></a>

# Why do I need it? #

Mutation Summary does five main things for you:

  * **It tells you how the document is different now from how it was.** As its name suggests, it summarizes what’s happened. It’s as if it takes a picture of the document when you first create it, and then again after each time it calls you back. When things have changed, it calls you with a concise description of exactly what’s different now from the last picture it took for you.
  * **It handles any and all changes, no matter how complex.** All kinds of things can happen to the DOM: values can change and but put back to what they were, large parts can be pulled out, changed, rearranged, put back. Mutation Summary can take any crazy thing you throw at it. Go ahead, tear the document to shreds, Mutation Summary won’t even blink.
  * **It lets you express what kinds of things you’re interested in.** It presents a query API that lets you tell it exactly what kinds of changes you’re interested in. This includes support for simple CSS-like selector descriptions of elements you care about.
  * **It’s fast.** The time and memory it takes is dependant on number of changes that occurred (which typically involves only a few nodes) -- not the size of your document (which is commonly thousands of nodes).
  * **It can automatically ignore changes you make during your callback.** Mutation Summary is going to call you back when changes have occurred. If you need to react to those changes by making more changes -- won’t you hear about those changes the next time it calls you back? Not unless you [ask for that](APIReference.md#configuration-options). By default, it stops watching the document immediately before it calls you back and resumes watching as soon as your callback finishes.

# What is it useful for? #

Lots of things, here are some examples:

  * **Browser extensions.** Want to make a browser extension that creates a link to your mapping application whenever an  address appears in a page? You’ll need to know when those addresses appear (and disappear).
  * **Implement missing HTML capabilities.** Think building web apps is too darn hard and you know what’s missing from HTML that would make it a snap? Writing the code for the desired behavior is only half the battle--you’ll also need to know when those elements and attributes show up and what happens to them. In fact, there’s already two widely used classes of libraries which do exactly this, but don’t currently have a good way to observe changes to the DOM.
    * **UI Widget** libraries, e.g. Dojo Widgets
    * **Templating** and/or **Databinding** libraries, e.g. Angular or KnockoutJS
  * **Text Editors.** HTML Text editors often want to observe what’s being input and “fix it up” so that they can maintain a consistent WYSWIG UI.

# What is this _not_ useful for? #

The intent here isn't to be all things to all use-cases. Mutation Summary is not meant to:

  * **Use the DOM as some sort of state-transition machine.** It won't report transient states that the DOM moved through. It will only tell you what the difference is between the previous state and the present one.
  * **Observing complex selectors.** It offers support for a simple [subset of CSS selectors](APIReference.md#supported-selector-syntax). Want to observe all elements that match `“div[foo] span.bar > p:first-child”`? Unfortunately, efficiently computing that is much harder and currently outside the scope of this library.

Note that both of the above use cases are possible given the data that the underlying Mutation Observers API provides -- we simply judged them to be outside the "80% use case" that we targeted with this particular library.

# Where can Mutation Summary be used? #

The Mutation Summary library depends on the presence of the Mutation Observer DOM API. Mutation Observers are available in

 * [Google Chrome](https://www.google.com/chrome)
 * [Firefox](http://www.mozilla.org/en-US/firefox/new/) 
 * [Safari](http://www.apple.com/safari/)
 * [Opera](http://www.opera.com/)
 * [IE11](http://www.microsoft.com/ie)

Mutation Observers is the work of the [W3C WebApps working group](http://www.w3.org/2008/webapps/). In the future it will be implemented in other browsers (we’ll keep the above list of supporting browsers as up-to-date as possible).

# Great. I want to get started. What’s next? #

  * Check out the [tutorial](Tutorial.md) and the [API reference](APIReference.md).

# Google groups discussion list #

 * [mutation-summary-discuss@googlegroups.com](https://groups.google.com/group/mutation-summary-discuss)
