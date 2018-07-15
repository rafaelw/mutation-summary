export interface IStringMap<T> {
	[key: string]: T;
}

export interface IMutationSummarySelector {
	qualifiers: IMutationSummaryQualifier[];
}

export interface IChildListChange {

}

export interface IMutationSummaryQualifier {
	attrName: string;
	matches(oldValue: string): boolean;
}

export interface IMutationSummaryQuery {
	element?: string;
	attribute?: string;
	all?: boolean;
	characterData?: boolean;
	elementAttributes?: string;
	// if false, ignore the class attribute when observing attribute changes
	classAttribute?: boolean;
	attributeList?: string[];
	elementFilter?: IMutationSummarySelector[];
}

export interface IMutationSummaryInit {
	callback: (summaries: IMutationSummaryData[]) => void;
	queries: IMutationSummaryQuery[];
	rootNode?: Node;
	/**
	 * a function that filters mutation records before
	 * they are passed to the summary engine
	 * */
	mutationFilter?: (rec: MutationRecord) => boolean;
	oldPreviousSibling?: boolean;
	observeOwnChanges?: boolean;
}

export interface IMutationSummaryConstructor {
	new(opts: IMutationSummaryInit, observe: boolean): IMutationSummary;
}

interface IMutationProjectionConstructor {
	new(rootNode: Node,
		mutations: MutationRecord[],
		selectors: IMutationSummarySelector[],
		calcReordered: boolean,
		calcOldPreviousSibling: boolean): IMutationProjection;
}

export interface IMutationProjection {

	processMutations(): any;


	ensureHasOldPreviousSiblingIfNeeded(node: Node): any;

	getChanged(summary: IMutationSummaryData, selectors: IMutationSummarySelector[], characterDataOnly: boolean): void;

	getOldParentNode(node: Node): Element;

	getOldPreviousSibling(node: Node): Node;

	getOldAttribute(element: Node, attrName: string): string;

	attributeChangedNodes(includeAttributes: string[]): IStringMap<Element[]>;

	getOldCharacterData(node: Node): string;

	getCharacterDataChanged(): Node[];

	getChildlistChange(el: Element): IChildListChange;

	processChildlistChanges(): any;

	wasReordered(node: Node): void;
}

export interface IMutationSummaryDataConstructor {
	new(projection: IMutationProjection, query: IMutationSummaryQuery): IMutationSummaryData;
}

export interface IMutationSummaryData {
	added: Node[];
	removed: Node[];
	reparented: Node[];
	reordered: Node[];
	valueChanged: Node[];
	attributeChanged: IStringMap<Element[]>;
	characterDataChanged: Node[];


	getOldParentNode(node: Node): Element;

	getOldAttribute(node: Node, name: string): string;

	getOldCharacterData(node: Node): string ;

	getOldPreviousSibling(node: Node): Node;

	getOldCharacterData(node: Node): string;

	getCharacterDataChanged(): Node[];

}


export interface IMutationSummary {
	disconnect(): IMutationSummaryData[];
	reconnect(): void;
	takeSummaries(): IMutationSummaryData[];
}

