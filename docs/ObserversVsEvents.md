#Mutation Observers vs Mutation Events

The naming is bit confusing. To clarify, a bit of history:

##Mutation Events

[DOM Mutation Events](http://www.w3.org/TR/DOM-Level-3-Events/#events-mutationevents) where aimed at solving the problem of being notified when something in the DOM changed. Unfortunately, they were slow, fired too frequently and were the source of many nasty browser bugs.

DOM Mutation Events have been deprecated and Mutation Observers are the intended replacement.

##Mutation Observers

The [W3C WebApps working group](http://www.w3.org/2008/webapps/) took up the task of designing a replacement for Mutation Events that would be fast, safe and concise. The result is [DOM Mutation Observers](http://dvcs.w3.org/hg/domcore/raw-file/tip/Overview.html#mutation-observers)

Here are the main differences between Mutation Events and Mutation Observers

 |       |Mutation Events | Mutation Observers|
 |----|--------------|-----------------|
 |Events? | Yes (slow) | No (just function callbacks) |
 |When? | Synchronous (i.e. right now) | Asynchronous (i.e. later) |
 |How many? | One per change | Multiple changes delivered in a single call|

#Mutation Observers vs. Mutation Summary (this library)

If Mutation Observers solves the problems with Mutation Events, why do I need a library?

The Mutation Summary library solves a problem that neither Mutation Observers nor Mutation Events was designed to: Providing you with a clear statement about the "net-effect' of what happened.

The information that Mutation Observers provides is just a list of “stuff that happened” to the DOM, in the order it happened -- kind of like a log. However, there's no guarantee that something that was done at one point in the log wasn't _undone_ at a later point. It's simply not safe to naively act on the log itself. Doing so risks poor performance (doing more work that you need to) and creating bugs in your web page (doing work under a mistaken set of assumptions).

Mutation Summary takes the log that Mutation Observers provides and outputs the set of things that _definately has happened_. Whatever Mutation Summary tells you is true -- and it's safe to go ahead and act on it.
