# Synchronously suspending observation #

Some uses may want to ignore changes to the DOM which take place **outside** their MutationSummary callback.

The inclination is to want a suspend/resume mechanism to support this. Unfortunately (as with many aspects of working with observation), to be strictly correct requires understanding a subtlety of the problem at hand.

The abstraction that MutationSummary provides is one where it is comparing the state of the DOM between two points in time. Asking this question, while wanting to ignore a smaller subset of that time range doesn't really have any meaning -- or worse it may mean different things to different use cases. For example, what if a use case suspend()s, adds a div, resume()s and then adds more content under the div? Should the next summary simply exclude the div or all of its children?

The way that MutationSummary handles this use case is that disconnect() **may** return an array of summaries which represent the changes to the DOM up to the point of disconnection. In essence, it is forcing a synchronous checkpoint returning the changes up to that point. reconnect() is available, and is simply a convenience of creating a new MutationSummary later with the same configuration.

So, the way to handle this case with MutationSummary is to disconnect(), check for any changes, then later reconnect().

For questions or problems, email the [discussion](https://groups.google.com/group/mutation-summary-discuss?pli=1) list.