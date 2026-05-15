


/**
 * Asset manager view class (standalone)
 * Not proud of the state of this code
 */
class AssetManagerView extends LS.Multipane.View {
    constructor(parent) {
        super({
            name: 'AssetManagerView',
            title: 'Content library',
            container: LS.Create({
                class: 'editor-asset-manager',
                inner: []
            })
        });

    }

    // FIXME: I know this isnt clean but im tired :(

    /**
     * Refreshes the project assets in the asset library.
     * @param {*} grid The grid element to refresh the project assets in
     */
    refreshProjectAssets(grid) {
        const resources = this.parent?.resources?.resources;
        if (!resources || resources.size === 0) return;

        for (const [hash, fileData] of resources) {
            const obj = {
                name: fileData.name,
                type: fileData.type,
                hash: fileData.hash,
                path: fileData.path,
                mimeType: fileData.mimeType,
                size: fileData.size,
                sourceType: fileData.sourceType,
                item: this.createItemFromFileData(fileData)
            };

            const itemElement = this.createAssetPreview(obj);
            grid.appendChild(itemElement);
        }
    }

    createItemFromFileData(fileData) {
        const baseItem = {
            label: fileData.name,
            resourceHash: fileData.hash
        };

        switch (fileData.type) {
            case 'sprite':
                return { type: 'sprite', ...baseItem };
            case 'video':
                return { type: 'video', ...baseItem, color: 'blue' };
            case 'sound':
                return { type: 'sound', ...baseItem, color: 'purple' };
            default:
                return { type: fileData.type || 'sprite', ...baseItem };
        }
    }
}




