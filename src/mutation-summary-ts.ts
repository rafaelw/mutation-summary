
import {
	IMutationSummaryInit, IMutationSummaryQuery,
	IStringMap, IMutationSummaryQualifier, IMutationSummarySelector,
	IMutationSummaryData,
	IMutationProjection, IMutationSummary
} from "./mutation-summary-interface";

(function (global: any) {
	if (!global) {
		console.error("mutation-summary: global is not defined");
	}

	interface IMutationObserver extends MutationObserver {
		new(callback: MutationCallback): MutationObserver;
	}

	enum MutationSummaryMovement {
		STAYED_OUT,
		ENTERED,
		STAYED_IN,
		REPARENTED,
		REORDERED,
		EXITED
	}

	interface IMutationProjectionImpl extends IMutationProjection {
		visitNode(node: Node, parentReachable: MutationSummaryMovement): any;
		computeMatchabilityChange(selector: IMutationSummarySelector, el: Element): MutationSummaryMovement;

		matchabilityChange(node: Node): MutationSummaryMovement;
	}

	const MutationObserverCtor: IMutationObserver =
		typeof window["WebKitMutationObserver"] !== 'undefined' ? window["WebKitMutationObserver"] :
			window["MutationObserver"];

	if (!MutationObserverCtor) {
		console.error('DOM Mutation Observers are required.');
		console.error('https://developer.mozilla.org/en-US/docs/DOM/MutationObserver');
		throw new Error('DOM Mutation Observers are required');
	}

	interface NumberMap<T> {
		[key: number]: T;
	}

	const SUMMARY_PROPS = ['added', 'removed', 'reordered', 'reparented',
	'valueChanged', 'characterDataChanged'];


	class NodeMap<T> {

		private static ID_PROP = '__mutation_summary_node_map_id__';
		private static nextId_: number = 1;

		private nodes: Node[];
		private values: T[];

		constructor() {
			this.nodes = [];
			this.values = [];
		}

		private isIndex(s: string): boolean {
			return +s === <any>s >>> 0;
		}

		private nodeId(node: Node) {
			var id = node[NodeMap.ID_PROP];
			if (!id)
				id = node[NodeMap.ID_PROP] = NodeMap.nextId_++;
			return id;
		}

		set(node: Node, value: T) {
			var id = this.nodeId(node);
			this.nodes[id] = node;
			this.values[id] = value;
		}

		get(node: Node): T {
			var id = this.nodeId(node);
			return this.values[id];
		}

		has(node: Node): boolean {
			return this.nodeId(node) in this.nodes;
		}

		delete(node: Node) {
			var id = this.nodeId(node);
			delete this.nodes[id];
			this.values[id] = undefined;
		}

		keys(): Node[] {
			var nodes: Node[] = [];
			for (var id in this.nodes) {
				if (!this.isIndex(id))
					continue;
				nodes.push(this.nodes[id]);
			}

			return nodes;
		}
	}

	/**
	 *  var reachableMatchableProduct = [
	 *  //  STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED
	 *    [ STAYED_OUT,  STAYED_OUT,  STAYED_OUT,  STAYED_OUT ], // STAYED_OUT
	 *    [ STAYED_OUT,  ENTERED,     ENTERED,     STAYED_OUT ], // ENTERED
	 *    [ STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED     ], // STAYED_IN
	 *    [ STAYED_OUT,  STAYED_OUT,  EXITED,      EXITED     ]  // EXITED
	 *  ];
	 */

	function enteredOrExited(changeType: MutationSummaryMovement): boolean {
		return changeType === MutationSummaryMovement.ENTERED || changeType === MutationSummaryMovement.EXITED;
	}

	class NodeChange {

		public isCaseInsensitive: boolean;

		constructor(public node: Node,
			public childList: boolean = false,
			public attributes: boolean = false,
			public characterData: boolean = false,
			public oldParentNode: Node = null,
			public added: boolean = false,
			private attributeOldValues: IStringMap<string> = null,
			public characterDataOldValue: string = null) {
			this.isCaseInsensitive =
				this.node.nodeType === Node.ELEMENT_NODE &&
				this.node instanceof HTMLElement &&
				this.node.ownerDocument instanceof HTMLDocument;
		}

		getAttributeOldValue(name: string): string {
			if (!this.attributeOldValues)
				return undefined;
			if (this.isCaseInsensitive)
				name = name.toLowerCase();
			return this.attributeOldValues[name];
		}

		getAttributeNamesMutated(): string[] {
			var names: string[] = [];
			if (!this.attributeOldValues)
				return names;
			for (var name in this.attributeOldValues) {
				names.push(name);
			}
			return names;
		}

		attributeMutated(name: string, oldValue: string) {
			this.attributes = true;
			this.attributeOldValues = this.attributeOldValues || {};

			if (name in this.attributeOldValues)
				return;

			this.attributeOldValues[name] = oldValue;
		}

		characterDataMutated(oldValue: string) {
			if (this.characterData)
				return;
			this.characterData = true;
			this.characterDataOldValue = oldValue;
		}

		// Note: is it possible to receive a removal followed by a removal. This
		// can occur if the removed node is added to an non-observed node, that
		// node is added to the observed area, and then the node removed from
		// it.
		removedFromParent(parent: Node) {
			this.childList = true;
			if (this.added || this.oldParentNode) {
				this.added = false;
				this.oldParentNode = this.oldParentNode || parent;
			}
			else {
				this.oldParentNode = parent;
			}
		}

		insertedIntoParent() {
			this.childList = true;
			this.added = true;
		}

		// An node's oldParent is
		//   -its present parent, if its parentNode was not changed.
		//   -null if the first thing that happened to it was an add.
		//   -the node it was removed from if the first thing that happened to it
		//      was a remove.
		getOldParent() {
			if (this.childList) {
				if (this.oldParentNode)
					return this.oldParentNode;
				if (this.added)
					return null;
			}

			return this.node.parentNode;
		}
	}

	class ChildListChange {

		public added: NodeMap<boolean>;
		public removed: NodeMap<boolean>;
		public maybeMoved: NodeMap<boolean>;
		public oldPrevious: NodeMap<Node>;
		public moved: NodeMap<boolean>;

		constructor() {
			this.added = new NodeMap<boolean>();
			this.removed = new NodeMap<boolean>();
			this.maybeMoved = new NodeMap<boolean>();
			this.oldPrevious = new NodeMap<Node>();
			this.moved = undefined;
		}
	}

	class TreeChanges extends NodeMap<NodeChange> {

		public anyParentsChanged: boolean;
		public anyAttributesChanged: boolean;
		public anyCharacterDataChanged: boolean;

		private reachableCache: NodeMap<boolean>;
		private wasReachableCache: NodeMap<boolean>;

		private rootNode: Node;

		constructor(rootNode: Node, mutations: MutationRecord[]) {
			super();

			this.rootNode = rootNode;
			this.reachableCache = undefined;
			this.wasReachableCache = undefined;
			this.anyParentsChanged = false;
			this.anyAttributesChanged = false;
			this.anyCharacterDataChanged = false;

			let node, change: NodeChange,
				mutation: MutationRecord;

			for (let m = 0; m < mutations.length; m++) {
				mutation = mutations[m];
				switch (mutation.type) {

					case 'childList':
						this.anyParentsChanged = true;
						for (let i = 0; i < mutation.removedNodes.length; i++) {
							node = mutation.removedNodes[i];
							this.getChange(node).removedFromParent(mutation.target);
						}
						for (let i = 0; i < mutation.addedNodes.length; i++) {
							node = mutation.addedNodes[i];
							this.getChange(node).insertedIntoParent();
						}
						break;

					case 'attributes':
							this.anyAttributesChanged = true;
							change = this.getChange(mutation.target);
							change.attributeMutated(mutation.attributeName, mutation.oldValue);
						break;

					case 'characterData':
							this.anyCharacterDataChanged = true;
							change = this.getChange(mutation.target);
							change.characterDataMutated(mutation.oldValue);
						break;
				}
			}
		}

		getChange(node: Node): NodeChange {
			let change = this.get(node);
			if (!change) {
				change = new NodeChange(node);
				this.set(node, change);
			}
			return change;
		}

		getOldParent(node: Node): Node {
			const change = this.get(node);
			return change ? change.getOldParent() : node.parentNode;
		}

		getIsReachable(node: Node): boolean {
			if (node === this.rootNode) {
				return true;
			}
			if (!node) {
				return false;
			}

			this.reachableCache = this.reachableCache || new NodeMap<boolean>();
			let isReachable = this.reachableCache.get(node);
			if (isReachable === undefined) {
				isReachable = this.getIsReachable(node.parentNode);
				this.reachableCache.set(node, isReachable);
			}
			return isReachable;
		}

		// A node wasReachable if its oldParent wasReachable.
		getWasReachable(node: Node): boolean {
			if (node === this.rootNode) {
				return true;
			}
			if (!node) {
				return false;
			}

			this.wasReachableCache = this.wasReachableCache || new NodeMap<boolean>();
			let wasReachable: boolean = this.wasReachableCache.get(node);
			if (wasReachable === undefined) {
				wasReachable = this.getWasReachable(this.getOldParent(node));
				this.wasReachableCache.set(node, wasReachable);
			}
			return wasReachable;
		}

		reachabilityChange(node: Node): MutationSummaryMovement {
			if (this.getIsReachable(node)) {
				return this.getWasReachable(node) ?
					MutationSummaryMovement.STAYED_IN : MutationSummaryMovement.ENTERED;
			}

			return this.getWasReachable(node) ?
				MutationSummaryMovement.EXITED : MutationSummaryMovement.STAYED_OUT;
		}
	}

	class MutationProjection implements IMutationProjection{

		private treeChanges: TreeChanges;
		private entered: Node[];
		private exited: Node[];
		private stayedIn: NodeMap<MutationSummaryMovement>;
		private visited: NodeMap<boolean>;
		private childListChangeMap: NodeMap<ChildListChange>;
		private characterDataOnly: boolean;
		private matchCache: NumberMap<NodeMap<MutationSummaryMovement>>;

		// TOOD(any)
		constructor(public rootNode: Node,
			public mutations: MutationRecord[],
			public selectors: IMutationSummarySelector[],
			public calcReordered: boolean,
			public calcOldPreviousSibling: boolean) {

			this.treeChanges = new TreeChanges(rootNode, mutations);
			this.entered = [];
			this.exited = [];
			this.stayedIn = new NodeMap<MutationSummaryMovement>();
			this.visited = new NodeMap<boolean>();
			this.childListChangeMap = undefined;
			this.characterDataOnly = undefined;
			this.matchCache = undefined;

			this.processMutations();
		}

		processMutations() {
			if (!this.treeChanges.anyParentsChanged &&
				!this.treeChanges.anyAttributesChanged)
				return;

			var changedNodes: Node[] = this.treeChanges.keys();
			for (var i = 0; i < changedNodes.length; i++) {
				this.visitNode(changedNodes[i], undefined);
			}
		}

		visitNode(node: Node, parentReachable: MutationSummaryMovement) {
			if (this.visited.has(node)) {
				return;
			}

			this.visited.set(node, true);

			const change = this.treeChanges.get(node);
			let reachable = parentReachable;

			// node inherits its parent's reachability change unless
			// its parentNode was mutated.
			if ((change && change.childList) || reachable == undefined) {
				reachable = this.treeChanges.reachabilityChange(node);
			}

			if (reachable === MutationSummaryMovement.STAYED_OUT) {
				return;
			}

			// Cache match results for sub-patterns.
			this.matchabilityChange(node);

			if (reachable === MutationSummaryMovement.ENTERED) {
				this.entered.push(node);
			}
			else if (reachable === MutationSummaryMovement.EXITED) {
				this.exited.push(node);
				this.ensureHasOldPreviousSiblingIfNeeded(node);

			}
			else if (reachable === MutationSummaryMovement.STAYED_IN) {
				let movement = MutationSummaryMovement.STAYED_IN;

				if (change && change.childList) {
					if (change.oldParentNode !== node.parentNode) {
						movement = MutationSummaryMovement.REPARENTED;
						this.ensureHasOldPreviousSiblingIfNeeded(node);
					}
					else if (this.calcReordered && this.wasReordered(node)) {
						movement = MutationSummaryMovement.REORDERED;
					}
				}

				this.stayedIn.set(node, movement);
			}

			if (reachable === MutationSummaryMovement.STAYED_IN)
				return;

			// reachable === ENTERED || reachable === EXITED.
			for (var child = node.firstChild; child; child = child.nextSibling) {
				this.visitNode(child, reachable);
			}
		}

		ensureHasOldPreviousSiblingIfNeeded(node: Node) {
			if (!this.calcOldPreviousSibling)
				return;

			this.processChildlistChanges();

			let parentNode = node.parentNode,
				nodeChange = this.treeChanges.get(node);
			if (nodeChange && nodeChange.oldParentNode)
				parentNode = nodeChange.oldParentNode;

			let change = this.childListChangeMap.get(parentNode);
			if (!change) {
				change = new ChildListChange();
				this.childListChangeMap.set(parentNode, change);
			}

			if (!change.oldPrevious.has(node)) {
				change.oldPrevious.set(node, node.previousSibling);
			}
		}

		getChanged(summary: IMutationSummaryData, selectors: MutationSummarySelector[], characterDataOnly: boolean) {
			this.selectors = selectors;
			this.characterDataOnly = characterDataOnly;
			let node: Node, matchable: MutationSummaryMovement;

			for (let i = 0; i < this.entered.length; i++) {
				node = this.entered[i];
				matchable = this.matchabilityChange(node);
				if (matchable === MutationSummaryMovement.ENTERED || matchable === MutationSummaryMovement.STAYED_IN)
					summary.added.push(node);
			}

			const stayedInNodes = this.stayedIn.keys();
			for (let i = 0; i < stayedInNodes.length; i++) {
				node = stayedInNodes[i];
				matchable = this.matchabilityChange(node);

				if (matchable === MutationSummaryMovement.ENTERED) {
					summary.added.push(node);
				}
				else if (matchable === MutationSummaryMovement.EXITED) {
					summary.removed.push(node);
				}
				else if (matchable === MutationSummaryMovement.STAYED_IN && (summary.reparented || summary.reordered)) {
					var movement: MutationSummaryMovement = this.stayedIn.get(node);
					if (summary.reparented && movement === MutationSummaryMovement.REPARENTED) {
						summary.reparented.push(node);
					}
					else if (summary.reordered && movement === MutationSummaryMovement.REORDERED) {
						summary.reordered.push(node);
					}
				}
			}

			for (let i = 0; i < this.exited.length; i++) {
				node = this.exited[i];
				matchable = this.matchabilityChange(node);
				if (matchable === MutationSummaryMovement.EXITED || matchable === MutationSummaryMovement.STAYED_IN)
					summary.removed.push(node);
			}
		}

		getOldParentNode(node: Node): Element {
			const change = this.treeChanges.get(node);
			if (change && change.childList) {
				return change.oldParentNode ? change.oldParentNode as Element : null;
			}
			const reachabilityChange = this.treeChanges.reachabilityChange(node);
			if (reachabilityChange === MutationSummaryMovement.STAYED_OUT || reachabilityChange === MutationSummaryMovement.ENTERED) {
				throw Error('getOldParentNode requested on invalid node.');
			}

			return node.parentNode as Element;
		}

		getOldPreviousSibling(node: Node): Node {
			let parentNode = node.parentNode;
			const nodeChange = this.treeChanges.get(node);
			if (nodeChange && nodeChange.oldParentNode)
				parentNode = nodeChange.oldParentNode;

			const change = this.childListChangeMap.get(parentNode);
			if (!change)
				throw Error('getOldPreviousSibling requested on invalid node.');

			return change.oldPrevious.get(node);
		}

		getOldAttribute(element: Node, attrName: string): string {
			const change = this.treeChanges.get(element);
			if (!change || !change.attributes) {
				throw Error('getOldAttribute requested on invalid node.');
			}
			const value = change.getAttributeOldValue(attrName);
			if (value === undefined) {
				throw Error('getOldAttribute requested for unchanged attribute name.');
			}

			return value;
		}

		attributeChangedNodes(includeAttributes: string[]): IStringMap<Element[]> {
			if (!this.treeChanges.anyAttributesChanged) {
				return {}; // No attributes mutations occurred.
			}

			let attributeFilter: IStringMap<boolean>,
				caseInsensitiveFilter: IStringMap<string>;
			if (includeAttributes) {
				attributeFilter = {};
				caseInsensitiveFilter = {};
				for (let i = 0; i < includeAttributes.length; i++) {
					var attrName: string = includeAttributes[i];
					attributeFilter[attrName] = true;
					caseInsensitiveFilter[attrName.toLowerCase()] = attrName;
				}
			}

			const result: IStringMap<Element[]> = {};
			const nodes = this.treeChanges.keys();

			let node: Node,
				element: Element;

			for (let i = 0; i < nodes.length; i++) {
				node = nodes[i];

				var change = this.treeChanges.get(node);
				if (!change.attributes)
					continue;

				if (MutationSummaryMovement.STAYED_IN !== this.treeChanges.reachabilityChange(node) ||
					MutationSummaryMovement.STAYED_IN !== this.matchabilityChange(node)) {
					continue;
				}

				element = <Element>node;
				const changedAttrNames = change.getAttributeNamesMutated();
				let attrName: string,
					oldValue: string;
				for (let j = 0; j < changedAttrNames.length; j++) {
					attrName = changedAttrNames[j];

					if (attributeFilter &&
						!attributeFilter[attrName] &&
						!(change.isCaseInsensitive && caseInsensitiveFilter[attrName])) {
						continue;
					}

					oldValue = change.getAttributeOldValue(attrName);
					if (oldValue === element.getAttribute(attrName)) {
						continue;
					}

					if (caseInsensitiveFilter && change.isCaseInsensitive) {
						attrName = caseInsensitiveFilter[attrName];
					}

					result[attrName] = result[attrName] || [];
					result[attrName].push(element);
				}
			}

			return result;
		}

		getOldCharacterData(node: Node): string {
			const change = this.treeChanges.get(node);
			if (!change || !change.characterData)
				throw Error('getOldCharacterData requested on invalid node.');

			return change.characterDataOldValue;
		}

		getCharacterDataChanged(): Node[] {
			if (!this.treeChanges.anyCharacterDataChanged)
				return []; // No characterData mutations occurred.

			const nodes: Array<Node> = this.treeChanges.keys(),
				result: Node[] = [];
			let target: Node,
				change: NodeChange;

			for (let i = 0; i < nodes.length; i++) {
				target = nodes[i];
				if (MutationSummaryMovement.STAYED_IN !== this.treeChanges.reachabilityChange(target))
					continue;

				change = this.treeChanges.get(target);
				if (!change.characterData ||
					target.textContent == change.characterDataOldValue)
					continue;

				result.push(target);
			}

			return result;
		}

		computeMatchabilityChange(selector: MutationSummarySelector, el: Element): MutationSummaryMovement {
			if (!this.matchCache)
				this.matchCache = [];
			if (!this.matchCache[selector.uid])
				this.matchCache[selector.uid] = new NodeMap<MutationSummaryMovement>();

			var cache = this.matchCache[selector.uid];
			var result = cache.get(el);
			if (result === undefined) {
				result = selector.matchabilityChange(el, this.treeChanges.get(el));
				cache.set(el, result);
			}
			return result;
		}

		matchabilityChange(node: Node): MutationSummaryMovement {
			// TODO(rafaelw): Include PI, CDATA?
			// Only include text nodes.
			if (this.characterDataOnly) {
				switch (node.nodeType) {
					case Node.COMMENT_NODE:
					case Node.TEXT_NODE:
						return MutationSummaryMovement.STAYED_IN;
					default:
						return MutationSummaryMovement.STAYED_OUT;
				}
			}

			// No element filter. Include all nodes.
			if (!this.selectors)
				return MutationSummaryMovement.STAYED_IN;

			// Element filter. Exclude non-elements.
			if (node.nodeType !== Node.ELEMENT_NODE)
				return MutationSummaryMovement.STAYED_OUT;

			var el = <Element>node;

			var matchChanges = this.selectors.map((selector: MutationSummarySelector) => {
				return this.computeMatchabilityChange(selector, el);
			});

			var accum: MutationSummaryMovement = MutationSummaryMovement.STAYED_OUT;
			var i = 0;

			while (accum !== MutationSummaryMovement.STAYED_IN && i < matchChanges.length) {
				switch (matchChanges[i]) {
					case MutationSummaryMovement.STAYED_IN:
						accum = MutationSummaryMovement.STAYED_IN;
						break;
					case MutationSummaryMovement.ENTERED:
						if (accum === MutationSummaryMovement.EXITED)
							accum = MutationSummaryMovement.STAYED_IN;
						else
							accum = MutationSummaryMovement.ENTERED;
						break;
					case MutationSummaryMovement.EXITED:
						if (accum === MutationSummaryMovement.ENTERED)
							accum = MutationSummaryMovement.STAYED_IN;
						else
							accum = MutationSummaryMovement.EXITED;
						break;
				}

				i++;
			}

			return accum;
		}

		getChildlistChange(el: Element): ChildListChange {
			var change = this.childListChangeMap.get(el);
			if (!change) {
				change = new ChildListChange();
				this.childListChangeMap.set(el, change);
			}

			return change;
		}

		processChildlistChanges() {
			if (this.childListChangeMap)
				return;

			this.childListChangeMap = new NodeMap<ChildListChange>();
			let mutation: MutationRecord,
				node: Node,
				change: ChildListChange,
				oldPrevious: Node;

			const recordOldPrevious = function (node: Node, previous: Node, change: ChildListChange) {
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

			for (var i = 0; i < this.mutations.length; i++) {
				mutation = this.mutations[i];
				if (mutation.type != 'childList')
					continue;

				if (this.treeChanges.reachabilityChange(mutation.target) !== MutationSummaryMovement.STAYED_IN &&
					!this.calcOldPreviousSibling)
					continue;

				change = this.getChildlistChange(<Element>mutation.target);

				oldPrevious = mutation.previousSibling;



				for (let j = 0; j < mutation.removedNodes.length; j++) {
					node = mutation.removedNodes[j];
					recordOldPrevious(node, oldPrevious, change);

					if (change.added.has(node)) {
						change.added.delete(node);
					} else {
						change.removed.set(node, true);
						change.maybeMoved.delete(node);
					}

					oldPrevious = node;
				}

				recordOldPrevious(mutation.nextSibling, oldPrevious, change);

				for (let j = 0; j < mutation.addedNodes.length; j++) {
					node = mutation.addedNodes[j];
					if (change.removed.has(node)) {
						change.removed.delete(node);
						change.maybeMoved.set(node, true);
					} else {
						change.added.set(node, true);
					}
				}
			}
		}

		wasReordered(node: Node) {
			if (!this.treeChanges.anyParentsChanged)
				return false;

			this.processChildlistChanges();

			var parentNode = node.parentNode;
			var nodeChange = this.treeChanges.get(node);
			if (nodeChange && nodeChange.oldParentNode)
				parentNode = nodeChange.oldParentNode;

			var change = this.childListChangeMap.get(parentNode);
			if (!change)
				return false;

			if (change.moved)
				return change.moved.get(node);

			change.moved = new NodeMap<boolean>();
			var pendingMoveDecision = new NodeMap<boolean>();

			function isMoved(node: Node) {
				if (!node)
					return false;
				if (!change.maybeMoved.has(node))
					return false;

				var didMove = change.moved.get(node);
				if (didMove !== undefined)
					return didMove;

				if (pendingMoveDecision.has(node)) {
					didMove = true;
				} else {
					pendingMoveDecision.set(node, true);
					didMove = getPrevious(node) !== getOldPrevious(node);
				}

				if (pendingMoveDecision.has(node)) {
					pendingMoveDecision.delete(node);
					change.moved.set(node, didMove);
				} else {
					didMove = change.moved.get(node);
				}

				return didMove;
			}

			var oldPreviousCache = new NodeMap<Node>();
			function getOldPrevious(node: Node): Node {
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

			var previousCache = new NodeMap<Node>();
			function getPrevious(node: Node): Node {
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

	class MutationSummaryData implements IMutationSummaryData {
		public added: Node[];
		public removed: Node[];
		public reparented: Node[];
		public reordered: Node[];
		public valueChanged: Node[];
		public attributeChanged: IStringMap<Element[]>;
		public characterDataChanged: Node[];

		constructor(private projection: IMutationProjection, query: IMutationSummaryQuery) {
			this.added = [];
			this.removed = [];
			this.reparented = query.all || query.element || query.characterData ? [] : undefined;
			this.reordered = query.all ? [] : undefined;
			this.projection = projection;

			projection.getChanged(this, query.elementFilter, query.characterData);

			if (query.all || query.attribute || query.attributeList) {
				var filter = query.attribute ? [query.attribute] : query.attributeList;
				var attributeChanged = projection.attributeChangedNodes(filter);

				if (query.attribute) {
					this.valueChanged = attributeChanged[query.attribute] || [];
				} else {
					this.attributeChanged = attributeChanged;
					if (query.attributeList) {
						query.attributeList.forEach((attrName) => {
							if (!this.attributeChanged.hasOwnProperty(attrName))
								this.attributeChanged[attrName] = [];
						});
					}
				}
			}

			if (query.all || query.characterData) {
				var characterDataChanged = projection.getCharacterDataChanged()

				if (query.characterData)
					this.valueChanged = characterDataChanged;
				else
					this.characterDataChanged = characterDataChanged;
			}

			if (this.reordered)
				this.getOldPreviousSibling = projection.getOldPreviousSibling.bind(projection);
		}

		getOldParentNode(node: Node): Element {
			return this.projection.getOldParentNode(node);
		}

		getOldAttribute(node: Node, name: string): string {
			return this.projection.getOldAttribute(node, name);
		}

		getOldPreviousSibling(node: Node): Node {
			return this.projection.getOldPreviousSibling(node);
		}

		getOldCharacterData(node: Node): string {
			return this.projection.getOldCharacterData(node);
		}

		getCharacterDataChanged(): Node[] {
			return this.projection.getCharacterDataChanged();
		}
	}

	// TODO(rafaelw): Allow ':' and '.' as valid name characters.
	const validNameInitialChar = /[a-zA-Z_]+/;
	const validNameNonInitialChar = /[a-zA-Z0-9_\-]+/;

	// TODO(rafaelw): Consider allowing backslash in the attrValue.
	// TODO(rafaelw): There's got a to be way to represent this state machine
	// more compactly???

	function escapeQuotes(value: string): string {
		return '"' + value.replace(/"/, '\\\"') + '"';
	}

	class MutationSummaryQualifier implements IMutationSummaryQualifier {
		public attrName: string;
		public attrValue: string;
		public contains: boolean;

		constructor() { }

		public matches(oldValue: string): boolean {
			if (oldValue === null)
				return false;

			if (this.attrValue === undefined)
				return true;

			if (!this.contains)
				return this.attrValue == oldValue;

			var tokens = oldValue.split(' ');
			for (var i = 0; i < tokens.length; i++) {
				if (this.attrValue === tokens[i])
					return true;
			}

			return false;
		}

		public toString(): string {
			const ret: string = '[' + this.attrName + ']';
			if (this.attrName === 'class' && this.contains) {
				return '.' + this.attrValue;
			}

			if (this.attrName === 'id' && !this.contains) {
				return '#' + this.attrValue;
			}

			if (this.contains) {
				return '[' + this.attrName + '~=' + escapeQuotes(this.attrValue) + ']';
			}

			if ('attrValue' in this) {
				return '[' + this.attrName + '=' + escapeQuotes(this.attrValue) + ']';
			}

			return ret;
		}
	}

	class MutationSummarySelector implements IMutationSummarySelector {
		private static nextUid: number = 1;
		private static matchesSelector: string = (function () {
			var element = document.createElement('div');
			if (typeof element['webkitMatchesSelector'] === 'function')
				return 'webkitMatchesSelector';
			if (typeof element['mozMatchesSelector'] === 'function')
				return 'mozMatchesSelector';
			if (typeof element['msMatchesSelector'] === 'function')
				return 'msMatchesSelector';

			return 'matchesSelector';
		})();

		public tagName: string;
		public qualifiers: IMutationSummaryQualifier[];
		public uid: number;

		private get caseInsensitiveTagName(): string {
			return this.tagName.toUpperCase();
		}

		get selectorString() {
			return this.tagName + this.qualifiers.join('');
		}

		constructor() {
			this.uid = MutationSummarySelector.nextUid++;
			this.qualifiers = [];
		}

		private isMatching(el: Element): boolean {
			return el[MutationSummarySelector.matchesSelector](this.selectorString);
		}

		private wasMatching(el: Element, change: NodeChange, isMatching: boolean): boolean {
			if (!change || !change.attributes)
				return isMatching;

			var tagName = change.isCaseInsensitive ? this.caseInsensitiveTagName : this.tagName;
			if (tagName !== '*' && tagName !== el.tagName)
				return false;

			const attributeOldValues: string[] = [];
			let anyChanged = false,
				qualifier: IMutationSummaryQualifier;
			for (let i = 0; i < this.qualifiers.length; i++) {
				qualifier = this.qualifiers[i];
				var oldValue = change.getAttributeOldValue(qualifier.attrName);
				attributeOldValues.push(oldValue);
				anyChanged = anyChanged || (oldValue !== undefined);
			}

			if (!anyChanged)
				return isMatching;

			for (let i = 0; i < this.qualifiers.length; i++) {
				qualifier = this.qualifiers[i];
				var oldValue = attributeOldValues[i];
				if (oldValue === undefined)
					oldValue = el.getAttribute(qualifier.attrName);
				if (!qualifier.matches(oldValue))
					return false;
			}

			return true;
		}

		public matchabilityChange(el: Element, change: NodeChange): MutationSummaryMovement {
			var isMatching = this.isMatching(el);
			if (isMatching)
				return this.wasMatching(el, change, isMatching) ? MutationSummaryMovement.STAYED_IN : MutationSummaryMovement.ENTERED;
			else
				return this.wasMatching(el, change, isMatching) ? MutationSummaryMovement.EXITED : MutationSummaryMovement.STAYED_OUT;
		}

		public static parseSelectors(input: string): MutationSummarySelector[] {
			var selectors: MutationSummarySelector[] = [];
			var currentSelector: MutationSummarySelector;
			var currentQualifier: MutationSummaryQualifier;

			function newSelector() {
				if (currentSelector) {
					if (currentQualifier) {
						currentSelector.qualifiers.push(currentQualifier);
						currentQualifier = undefined;
					}

					selectors.push(currentSelector);
				}
				currentSelector = new MutationSummarySelector();
			}

			function newQualifier() {
				if (currentQualifier)
					currentSelector.qualifiers.push(currentQualifier);

				currentQualifier = new MutationSummaryQualifier();
			}

			const WHITESPACE = /\s/;
			var valueQuoteChar: string;
			const SYNTAX_ERROR = 'Invalid or unsupported selector syntax.';

			const SELECTOR = 1;
			const TAG_NAME = 2;
			const QUALIFIER = 3;
			const QUALIFIER_NAME_FIRST_CHAR = 4;
			const QUALIFIER_NAME = 5;
			const ATTR_NAME_FIRST_CHAR = 6;
			const ATTR_NAME = 7;
			const EQUIV_OR_ATTR_QUAL_END = 8;
			const EQUAL = 9;
			const ATTR_QUAL_END = 10;
			const VALUE_FIRST_CHAR = 11;
			const VALUE = 12;
			const QUOTED_VALUE = 13;
			const SELECTOR_SEPARATOR = 14;

			let state = SELECTOR;
			let i = 0,
				c: string;
			while (i < input.length) {
				c = input[i++];

				switch (state) {
					case SELECTOR:
						if (c.match(validNameInitialChar)) {
							newSelector();
							currentSelector.tagName = c;
							state = TAG_NAME;
							break;
						}

						if (c === '*') {
							newSelector();
							currentSelector.tagName = '*';
							state = QUALIFIER;
							break;
						}

						if (c === '.') {
							newSelector();
							newQualifier();
							currentSelector.tagName = '*';
							currentQualifier.attrName = 'class';
							currentQualifier.contains = true;
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '#') {
							newSelector();
							newQualifier();
							currentSelector.tagName = '*';
							currentQualifier.attrName = 'id';
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '[') {
							newSelector();
							newQualifier();
							currentSelector.tagName = '*';
							currentQualifier.attrName = '';
							state = ATTR_NAME_FIRST_CHAR;
							break;
						}

						if (c.match(WHITESPACE))
							break;

						throw Error(SYNTAX_ERROR);

					case TAG_NAME:
						if (c.match(validNameNonInitialChar)) {
							currentSelector.tagName += c;
							break;
						}

						if (c === '.') {
							newQualifier();
							currentQualifier.attrName = 'class';
							currentQualifier.contains = true;
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '#') {
							newQualifier();
							currentQualifier.attrName = 'id';
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '[') {
							newQualifier();
							currentQualifier.attrName = '';
							state = ATTR_NAME_FIRST_CHAR;
							break;
						}

						if (c.match(WHITESPACE)) {
							state = SELECTOR_SEPARATOR;
							break;
						}

						if (c === ',') {
							state = SELECTOR;
							break;
						}

						throw Error(SYNTAX_ERROR);

					case QUALIFIER:
						if (c === '.') {
							newQualifier();
							currentQualifier.attrName = 'class';
							currentQualifier.contains = true;
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '#') {
							newQualifier();
							currentQualifier.attrName = 'id';
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '[') {
							newQualifier();
							currentQualifier.attrName = '';
							state = ATTR_NAME_FIRST_CHAR;
							break;
						}

						if (c.match(WHITESPACE)) {
							state = SELECTOR_SEPARATOR;
							break;
						}

						if (c === ',') {
							state = SELECTOR;
							break;
						}

						throw Error(SYNTAX_ERROR);

					case QUALIFIER_NAME_FIRST_CHAR:
						if (c.match(validNameInitialChar)) {
							currentQualifier.attrValue = c;
							state = QUALIFIER_NAME;
							break;
						}

						throw Error(SYNTAX_ERROR);

					case QUALIFIER_NAME:
						if (c.match(validNameNonInitialChar)) {
							currentQualifier.attrValue += c;
							break;
						}

						if (c === '.') {
							newQualifier();
							currentQualifier.attrName = 'class';
							currentQualifier.contains = true;
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '#') {
							newQualifier();
							currentQualifier.attrName = 'id';
							state = QUALIFIER_NAME_FIRST_CHAR;
							break;
						}
						if (c === '[') {
							newQualifier();
							state = ATTR_NAME_FIRST_CHAR;
							break;
						}

						if (c.match(WHITESPACE)) {
							state = SELECTOR_SEPARATOR;
							break;
						}
						if (c === ',') {
							state = SELECTOR;
							break
						}

						throw Error(SYNTAX_ERROR);

					case ATTR_NAME_FIRST_CHAR:
						if (c.match(validNameInitialChar)) {
							currentQualifier.attrName = c;
							state = ATTR_NAME;
							break;
						}

						if (c.match(WHITESPACE))
							break;

						throw Error(SYNTAX_ERROR);

					case ATTR_NAME:
						if (c.match(validNameNonInitialChar)) {
							currentQualifier.attrName += c;
							break;
						}

						if (c.match(WHITESPACE)) {
							state = EQUIV_OR_ATTR_QUAL_END;
							break;
						}

						if (c === '~') {
							currentQualifier.contains = true;
							state = EQUAL;
							break;
						}

						if (c === '=') {
							currentQualifier.attrValue = '';
							state = VALUE_FIRST_CHAR;
							break;
						}

						if (c === ']') {
							state = QUALIFIER;
							break;
						}

						throw Error(SYNTAX_ERROR);

					case EQUIV_OR_ATTR_QUAL_END:
						if (c === '~') {
							currentQualifier.contains = true;
							state = EQUAL;
							break;
						}

						if (c === '=') {
							currentQualifier.attrValue = '';
							state = VALUE_FIRST_CHAR;
							break;
						}

						if (c === ']') {
							state = QUALIFIER;
							break;
						}

						if (c.match(WHITESPACE))
							break;

						throw Error(SYNTAX_ERROR);

					case EQUAL:
						if (c === '=') {
							currentQualifier.attrValue = '';
							state = VALUE_FIRST_CHAR
							break;
						}

						throw Error(SYNTAX_ERROR);

					case ATTR_QUAL_END:
						if (c === ']') {
							state = QUALIFIER;
							break;
						}

						if (c.match(WHITESPACE))
							break;

						throw Error(SYNTAX_ERROR);

					case VALUE_FIRST_CHAR:
						if (c.match(WHITESPACE))
							break;

						if (c === '"' || c === "'") {
							valueQuoteChar = c;
							state = QUOTED_VALUE;
							break;
						}

						currentQualifier.attrValue += c;
						state = VALUE;
						break;

					case VALUE:
						if (c.match(WHITESPACE)) {
							state = ATTR_QUAL_END;
							break;
						}
						if (c === ']') {
							state = QUALIFIER;
							break;
						}
						if (c === "'" || c == '"')
							throw Error(SYNTAX_ERROR);

						currentQualifier.attrValue += c;
						break;

					case QUOTED_VALUE:
						if (c === valueQuoteChar) {
							state = ATTR_QUAL_END;
							break;
						}

						currentQualifier.attrValue += c;
						break;

					case SELECTOR_SEPARATOR:
						if (c.match(WHITESPACE))
							break;

						if (c === ',') {
							state = SELECTOR;
							break
						}

						throw Error(SYNTAX_ERROR);
				}
			}

			switch (state) {
				case SELECTOR:
				case TAG_NAME:
				case QUALIFIER:
				case QUALIFIER_NAME:
				case SELECTOR_SEPARATOR:
					// Valid end states.
					newSelector();
					break;
				default:
					throw Error(SYNTAX_ERROR);
			}

			if (!selectors.length)
				throw Error(SYNTAX_ERROR);

			return selectors;
		}
	}

	const attributeFilterPattern = /^([a-zA-Z:_]+[a-zA-Z0-9_\-:\.]*)$/;

	function validateAttribute(attribute: string) {
		if (typeof attribute != 'string')
			throw Error('Invalid request opion. attribute must be a non-zero length string.');

		attribute = attribute.trim();

		if (!attribute)
			throw Error('Invalid request opion. attribute must be a non-zero length string.');


		if (!attribute.match(attributeFilterPattern))
			throw Error('Invalid request option. invalid attribute name: ' + attribute);

		return attribute;
	}

	function validateElementAttributes(attribs: string): string[] {
		if (!attribs.trim().length)
			throw Error('Invalid request option: elementAttributes must contain at least one attribute.');

		const lowerAttributes = {};
		const attributes = {};
		const tokens = attribs.split(/\s+/);
		let name: string,
			nameLower: string;

		for (let i = 0; i < tokens.length; i++) {
			name = tokens[i];
			if (!name)
				continue;

			name = validateAttribute(name);
			nameLower = name.toLowerCase();
			if (lowerAttributes[nameLower])
				throw Error('Invalid request option: observing multiple case variations of the same attribute is not supported.');

			attributes[name] = true;
			lowerAttributes[nameLower] = true;
		}

		return Object.keys(attributes);
	}



	function elementFilterAttributes(selectors: IMutationSummarySelector[], ignoreClassAttribute: boolean): string[] {
		const attributes: IStringMap<boolean> = {};

		selectors.forEach((selector) => {
			selector.qualifiers.forEach((qualifier) => {
				if (!ignoreClassAttribute || qualifier.attrName !== "class") {
					attributes[qualifier.attrName] = true;
				}
			});
		});

		return Object.keys(attributes);
	}


	class MutationSummary implements IMutationSummary {
		public static NodeMap = NodeMap; // exposed for use in TreeMirror.
		public static parseElementFilter = MutationSummarySelector.parseSelectors; // exposed for testing.

		public static createQueryValidator: (root: Node, query: IMutationSummaryQuery) => any;
		private connected: boolean;
		private options: IMutationSummaryInit;
		private observer: MutationObserver;
		private observerOptions: MutationObserverInit;
		private root: Node;
		private callback: (summaries: IMutationSummaryData[]) => any;
		private elementFilter: MutationSummarySelector[];
		private calcReordered: boolean;
		private queryValidators: any[];

		private static optionKeys: IStringMap<boolean> = {
			'callback': true, // required
			'queries': true,  // required
			'rootNode': true,
			'oldPreviousSibling': true,
			'observeOwnChanges': true,
			"mutationFilter": false
		};

		private filterIgnoredMutations(rawMutations: Array<MutationRecord>): Array<MutationRecord> {
			if (!this.options.mutationFilter || !rawMutations) {
				return rawMutations;
			}
			const ret: Array<MutationRecord> = [],
				filter = this.options.mutationFilter;

			let mutation: MutationRecord,
				add;
			for (let i = rawMutations.length - 1; i >= 0; --i) {
				mutation = rawMutations[i];
				if (filter(mutation)) {
					ret.push(mutation);
				}
			}

			return ret;
		}

		private static createObserverOptions(queries: IMutationSummaryQuery[]): MutationObserverInit {
			const observerOptions: MutationObserverInit = {
				childList: true,
				subtree: true
			};

			let attributeFilter: IStringMap<boolean>;
			function observeAttributes(attributes?: string[]) {
				if (observerOptions.attributes && !attributeFilter)
					return; // already observing all.

				observerOptions.attributes = true;
				observerOptions.attributeOldValue = true;

				if (!attributes) {
					// observe all.
					attributeFilter = undefined;
					return;
				}

				// add to observed.
				attributeFilter = attributeFilter || {};
				attributes.forEach((attribute) => {
					attributeFilter[attribute] = true;
					attributeFilter[attribute.toLowerCase()] = true;
				});
			}

			queries.forEach((query) => {
				if (query.characterData) {
					observerOptions.characterData = true;
					observerOptions.characterDataOldValue = true;
					return;
				}

				if (query.all) {
					observeAttributes();
					observerOptions.characterData = true;
					observerOptions.characterDataOldValue = true;
					return;
				}

				if (query.attribute) {
					observeAttributes([query.attribute.trim()]);
					return;
				}

				var attributes = elementFilterAttributes(query.elementFilter, query.classAttribute === false).concat(query.attributeList || []);
				if (attributes.length)
					observeAttributes(attributes);
			});

			if (attributeFilter)
				observerOptions.attributeFilter = Object.keys(attributeFilter);

			return observerOptions;
		}

		private static validateOptions(options: IMutationSummaryInit): IMutationSummaryInit {
			for (var prop in options) {
				if (!(prop in MutationSummary.optionKeys))
					throw Error('Invalid option: ' + prop);
			}

			if (typeof options.callback !== 'function')
				throw Error('Invalid options: callback is required and must be a function');

			if (!options.queries || !options.queries.length)
				throw Error('Invalid options: queries must contain at least one query request object.');

			var opts: IMutationSummaryInit = {
				callback: options.callback,
				mutationFilter: options.mutationFilter,
				rootNode: options.rootNode || document,
				observeOwnChanges: !!options.observeOwnChanges,
				oldPreviousSibling: !!options.oldPreviousSibling,
				queries: []
			};

			for (var i = 0; i < options.queries.length; i++) {
				var request = options.queries[i];

				// all
				if (request.all) {
					if (Object.keys(request).length > 1)
						throw Error('Invalid request option. all has no options.');

					opts.queries.push({ all: true });
					continue;
				}

				// attribute
				if ('attribute' in request) {
					var query: IMutationSummaryQuery = {
						attribute: validateAttribute(request.attribute)
					};

					query.elementFilter = MutationSummarySelector.parseSelectors('*[' + query.attribute + ']');

					if (Object.keys(request).length > 1)
						throw Error('Invalid request option. attribute has no options.');

					opts.queries.push(query);
					continue;
				}

				// element
				if ('element' in request) {
					var requestOptionCount = Object.keys(request).length;
					var query: IMutationSummaryQuery = {
						element: request.element,
						elementFilter: MutationSummarySelector.parseSelectors(request.element)
					};

					if (request.hasOwnProperty('elementAttributes')) {
						query.attributeList = validateElementAttributes(request.elementAttributes);
						requestOptionCount--;
					}

					if (request.classAttribute !== undefined) {
						query.classAttribute = request.classAttribute !== false;
						requestOptionCount--;
					}

					if (requestOptionCount > 1)
						throw Error('Invalid request option. element only allows elementAttributes option.');

					opts.queries.push(query);
					continue;
				}

				// characterData
				if (request.characterData) {
					if (Object.keys(request).length > 1)
						throw Error('Invalid request option. characterData has no options.');

					opts.queries.push({ characterData: true });
					continue;
				}

				throw Error('Invalid request option. Unknown query request.');
			}

			return opts;
		}

		private createSummaries(rawMutations: MutationRecord[]): IMutationSummaryData[] {
			const mutations: Array<MutationRecord> = this.filterIgnoredMutations(rawMutations);
			if (!mutations || !mutations.length) {
				return [];
			}
			const projection = new MutationProjection(this.root, mutations, this.elementFilter, this.calcReordered, this.options.oldPreviousSibling);
			const summaries: MutationSummaryData[] = [];
			for (let i = 0; i < this.options.queries.length; i++) {
				summaries.push(new MutationSummaryData(projection, this.options.queries[i]));
			}

			return summaries;
		}

		private checkpointQueryValidators() {
			this.queryValidators.forEach((validator) => {
				if (validator)
					validator.recordPreviousState();
			});
		}

		private runQueryValidators(summaries: IMutationSummaryData[]) {
			this.queryValidators.forEach((validator, index) => {
				if (validator)
					validator.validate(summaries[index]);
			});
		}

		private changesToReport(summaries: IMutationSummaryData[]): boolean {
			return summaries.some((summary) => {
				if (SUMMARY_PROPS.some(function (prop) { return summary[prop] && summary[prop].length; }))
					return true;

				if (summary.attributeChanged) {
					var attrNames = Object.keys(summary.attributeChanged);
					var attrsChanged = attrNames.some((attrName) => {
						return !!summary.attributeChanged[attrName].length
					});
					if (attrsChanged)
						return true;
				}
				return false;
			});
		}

		constructor(opts: IMutationSummaryInit, observe: boolean) {
			this.connected = false;
			this.options = MutationSummary.validateOptions(opts);
			this.observerOptions = MutationSummary.createObserverOptions(this.options.queries);
			this.root = this.options.rootNode;
			this.callback = this.options.callback;

			this.elementFilter = Array.prototype.concat.apply([], this.options.queries.map((query: IMutationSummaryQuery) => {
				return query.elementFilter ? query.elementFilter : [];
			}));
			if (!this.elementFilter.length)
				this.elementFilter = undefined;

			this.calcReordered = this.options.queries.some((query: IMutationSummaryQuery) => {
				return query.all;
			});

			this.queryValidators = []; // TODO(rafaelw): Shouldn't always define this.
			if (MutationSummary.createQueryValidator) {
				this.queryValidators = this.options.queries.map((query: IMutationSummaryQuery) => {
					return MutationSummary.createQueryValidator(this.root, query);
				});
			}

			this.observer = new MutationObserverCtor((mutations: MutationRecord[]) => {
				this.observerCallback(mutations);
			});

			if (observe) {
				this.reconnect();
			}
		}

		private observerCallback(mutations: MutationRecord[]) {
			if (!this.options.observeOwnChanges)
				this.observer.disconnect();

			const summaries = this.createSummaries(mutations);
			this.runQueryValidators(summaries);

			if (this.options.observeOwnChanges)
				this.checkpointQueryValidators();

			if (this.changesToReport(summaries))
				this.callback(summaries);

			// disconnect() may have been called during the callback.
			if (!this.options.observeOwnChanges && this.connected) {
				this.checkpointQueryValidators();
				this.observer.observe(this.root, this.observerOptions);
			}
		}

		reconnect() {
			if (this.connected) {
				return;
			}
			this.observer.observe(this.root, this.observerOptions);
			this.connected = true;
			this.checkpointQueryValidators();
		}

		disconnect(): IMutationSummaryData[] {
			const summaries = this.takeSummaries();
			this.observer.disconnect();
			this.connected = false;
			return summaries;
		}

		takeSummaries(): IMutationSummaryData[] {
			if (!this.connected)
				throw Error('Not connected');

			const summaries = this.createSummaries(this.observer.takeRecords());
			return this.changesToReport(summaries) ? summaries : undefined;
		}

	}

/**
 * Polyfill from mozilla
 */
	if (!Element.prototype.matches) {
		Element.prototype.matches = 
			Element.prototype["matchesSelector"] || 
			Element.prototype["mozMatchesSelector"] ||
			Element.prototype["msMatchesSelector"] || 
			Element.prototype["oMatchesSelector"] || 
			Element.prototype["webkitMatchesSelector"] ||
			function(s) {
				var matches = (this.document || this.ownerDocument).querySelectorAll(s),
					i = matches.length;
				while (--i >= 0 && matches.item(i) !== this) {}
				return i > -1;            
			};
	}	global.MutationSummary = MutationSummary;

}(window));