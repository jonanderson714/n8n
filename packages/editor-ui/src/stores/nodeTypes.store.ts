import {
	getNodeParameterOptions,
	getNodesInformation,
	getNodeTranslationHeaders,
	getNodeTypes,
	getResourceLocatorResults,
	getResourceMapperFields,
} from '@/api/nodeTypes';
import {
	DEFAULT_NODETYPE_VERSION,
	HTTP_REQUEST_NODE_TYPE,
	STORES,
	CREDENTIAL_ONLY_HTTP_NODE_VERSION,
} from '@/constants';
import type {
	INodeTypesState,
	IResourceLocatorReqParams,
	ResourceMapperReqParams,
} from '@/Interface';
import { addHeaders, addNodeTranslation } from '@/plugins/i18n';
import { omit } from '@/utils';
import type {
	ConnectionTypes,
	ILoadOptions,
	INode,
	INodeCredentials,
	INodeListSearchResult,
	INodeOutputConfiguration,
	INodeParameters,
	INodePropertyOptions,
	INodeTypeDescription,
	INodeTypeNameVersion,
	ResourceMapperFields,
	Workflow,
} from 'n8n-workflow';
import { NodeConnectionType, NodeHelpers } from 'n8n-workflow';
import { defineStore } from 'pinia';
import { useCredentialsStore } from './credentials.store';
import { useRootStore } from './n8nRoot.store';
import {
	getCredentialOnlyNodeType,
	getCredentialTypeName,
	isCredentialOnlyNodeType,
} from '@/utils/credentialOnlyNodes';

function getNodeVersions(nodeType: INodeTypeDescription) {
	return Array.isArray(nodeType.version) ? nodeType.version : [nodeType.version];
}

export const useNodeTypesStore = defineStore(STORES.NODE_TYPES, {
	state: (): INodeTypesState => ({
		nodeTypes: {},
	}),
	getters: {
		allNodeTypes(): INodeTypeDescription[] {
			return Object.values(this.nodeTypes).reduce<INodeTypeDescription[]>(
				(allNodeTypes, nodeType) => {
					const versionNumbers = Object.keys(nodeType).map(Number);
					const allNodeVersions = versionNumbers.map((version) => nodeType[version]);

					return [...allNodeTypes, ...allNodeVersions];
				},
				[],
			);
		},
		allLatestNodeTypes(): INodeTypeDescription[] {
			return Object.values(this.nodeTypes).reduce<INodeTypeDescription[]>(
				(allLatestNodeTypes, nodeVersions) => {
					const versionNumbers = Object.keys(nodeVersions).map(Number);
					const latestNodeVersion = nodeVersions[Math.max(...versionNumbers)];

					if (!latestNodeVersion) return allLatestNodeTypes;

					return [...allLatestNodeTypes, latestNodeVersion];
				},
				[],
			);
		},
		getNodeType() {
			return (nodeTypeName: string, version?: number): INodeTypeDescription | null => {
				if (isCredentialOnlyNodeType(nodeTypeName)) {
					return this.getCredentialOnlyNodeType(nodeTypeName, version);
				}

				const nodeVersions = this.nodeTypes[nodeTypeName];

				if (!nodeVersions) return null;

				const versionNumbers = Object.keys(nodeVersions).map(Number);
				const nodeType = nodeVersions[version ?? Math.max(...versionNumbers)];
				return nodeType ?? null;
			};
		},
		getCredentialOnlyNodeType() {
			return (nodeTypeName: string, version?: number): INodeTypeDescription | null => {
				const credentialName = getCredentialTypeName(nodeTypeName);
				const httpNode = this.getNodeType(
					HTTP_REQUEST_NODE_TYPE,
					version ?? CREDENTIAL_ONLY_HTTP_NODE_VERSION,
				);
				const credential = useCredentialsStore().getCredentialTypeByName(credentialName);
				return getCredentialOnlyNodeType(httpNode, credential) ?? null;
			};
		},
		isConfigNode() {
			return (workflow: Workflow, node: INode, nodeTypeName: string): boolean => {
				const nodeType = this.getNodeType(nodeTypeName);
				if (!nodeType) {
					return false;
				}
				const outputs = NodeHelpers.getNodeOutputs(workflow, node, nodeType);
				const outputTypes = NodeHelpers.getConnectionTypes(outputs);

				return outputTypes
					? outputTypes.filter((output) => output !== NodeConnectionType.Main).length > 0
					: false;
			};
		},
		isConfigurableNode() {
			return (workflow: Workflow, node: INode, nodeTypeName: string): boolean => {
				const nodeType = this.getNodeType(nodeTypeName);
				if (nodeType === null) {
					return false;
				}
				const inputs = NodeHelpers.getNodeInputs(workflow, node, nodeType);
				const inputTypes = NodeHelpers.getConnectionTypes(inputs);

				return inputTypes
					? inputTypes.filter((input) => input !== NodeConnectionType.Main).length > 0
					: false;
			};
		},
		isTriggerNode() {
			return (nodeTypeName: string) => {
				const nodeType = this.getNodeType(nodeTypeName);
				return !!(nodeType && nodeType.group.includes('trigger'));
			};
		},
		isCoreNodeType() {
			return (nodeType: INodeTypeDescription) => {
				return nodeType.codex?.categories?.includes('Core Nodes');
			};
		},
		visibleNodeTypes(): INodeTypeDescription[] {
			return this.allLatestNodeTypes.filter((nodeType: INodeTypeDescription) => !nodeType.hidden);
		},
		/**
		 * Getter for node default names ending with a number: `'S3'`, `'Magento 2'`, etc.
		 */
		nativelyNumberSuffixedDefaults(): string[] {
			return this.allNodeTypes.reduce<string[]>((acc, cur) => {
				if (/\d$/.test(cur.defaults.name as string)) acc.push(cur.defaults.name as string);
				return acc;
			}, []);
		},
		visibleNodeTypesByOutputConnectionTypeNames(): { [key: string]: string[] } {
			const nodesByOutputType = this.visibleNodeTypes.reduce(
				(acc, node) => {
					const outputTypes = node.outputs;
					if (Array.isArray(outputTypes)) {
						outputTypes.forEach((value: ConnectionTypes | INodeOutputConfiguration) => {
							const outputType = typeof value === 'string' ? value : value.type;
							if (!acc[outputType]) {
								acc[outputType] = [];
							}
							acc[outputType].push(node.name);
						});
					}

					return acc;
				},
				{} as { [key: string]: string[] },
			);

			return nodesByOutputType;
		},
		visibleNodeTypesByInputConnectionTypeNames(): { [key: string]: string[] } {
			const nodesByOutputType = this.visibleNodeTypes.reduce(
				(acc, node) => {
					const inputTypes = node.inputs;
					if (Array.isArray(inputTypes)) {
						inputTypes.forEach((value: ConnectionTypes | INodeOutputConfiguration) => {
							const outputType = typeof value === 'string' ? value : value.type;
							if (!acc[outputType]) {
								acc[outputType] = [];
							}
							acc[outputType].push(node.name);
						});
					}

					return acc;
				},
				{} as { [key: string]: string[] },
			);

			return nodesByOutputType;
		},
	},
	actions: {
		setNodeTypes(newNodeTypes: INodeTypeDescription[] = []): void {
			const nodeTypes = newNodeTypes.reduce<Record<string, Record<string, INodeTypeDescription>>>(
				(acc, newNodeType) => {
					const newNodeVersions = getNodeVersions(newNodeType);

					if (newNodeVersions.length === 0) {
						const singleVersion = { [DEFAULT_NODETYPE_VERSION]: newNodeType };

						acc[newNodeType.name] = singleVersion;
						return acc;
					}

					for (const version of newNodeVersions) {
						// Node exists with the same name
						if (acc[newNodeType.name]) {
							acc[newNodeType.name][version] = Object.assign(
								acc[newNodeType.name][version] ?? {},
								newNodeType,
							);
						} else {
							acc[newNodeType.name] = Object.assign(acc[newNodeType.name] ?? {}, {
								[version]: newNodeType,
							});
						}
					}

					return acc;
				},
				{ ...this.nodeTypes },
			);
			this.nodeTypes = nodeTypes;
		},
		removeNodeTypes(nodeTypesToRemove: INodeTypeDescription[]): void {
			this.nodeTypes = nodeTypesToRemove.reduce(
				(oldNodes, newNodeType) => omit(newNodeType.name, oldNodes),
				this.nodeTypes,
			);
		},
		async getNodesInformation(
			nodeInfos: INodeTypeNameVersion[],
			replace = true,
		): Promise<INodeTypeDescription[]> {
			const rootStore = useRootStore();
			const nodesInformation = await getNodesInformation(rootStore.getRestApiContext, nodeInfos);

			nodesInformation.forEach((nodeInformation) => {
				if (nodeInformation.translation) {
					const nodeType = nodeInformation.name.replace('n8n-nodes-base.', '');

					addNodeTranslation({ [nodeType]: nodeInformation.translation }, rootStore.defaultLocale);
				}
			});
			if (replace) this.setNodeTypes(nodesInformation);

			return nodesInformation;
		},
		async getFullNodesProperties(nodesToBeFetched: INodeTypeNameVersion[]): Promise<void> {
			const credentialsStore = useCredentialsStore();
			await credentialsStore.fetchCredentialTypes(true);
			await this.getNodesInformation(nodesToBeFetched);
		},
		async getNodeTypes(): Promise<void> {
			const rootStore = useRootStore();
			const nodeTypes = await getNodeTypes(rootStore.getBaseUrl);
			if (nodeTypes.length) {
				this.setNodeTypes(nodeTypes);
			}
		},
		async getNodeTranslationHeaders(): Promise<void> {
			const rootStore = useRootStore();
			const headers = await getNodeTranslationHeaders(rootStore.getRestApiContext);

			if (headers) {
				addHeaders(headers, rootStore.defaultLocale);
			}
		},
		async getNodeParameterOptions(sendData: {
			nodeTypeAndVersion: INodeTypeNameVersion;
			path: string;
			methodName?: string;
			loadOptions?: ILoadOptions;
			currentNodeParameters: INodeParameters;
			credentials?: INodeCredentials;
		}): Promise<INodePropertyOptions[]> {
			const rootStore = useRootStore();
			return getNodeParameterOptions(rootStore.getRestApiContext, sendData);
		},
		async getResourceLocatorResults(
			sendData: IResourceLocatorReqParams,
		): Promise<INodeListSearchResult> {
			const rootStore = useRootStore();
			return getResourceLocatorResults(rootStore.getRestApiContext, sendData);
		},
		async getResourceMapperFields(
			sendData: ResourceMapperReqParams,
		): Promise<ResourceMapperFields | null> {
			const rootStore = useRootStore();
			try {
				return await getResourceMapperFields(rootStore.getRestApiContext, sendData);
			} catch (error) {
				return null;
			}
		},
	},
});
