export default class PatcherView extends LS.View {
    constructor() {
        super({
            name: "PatcherView",
            title: "Patcher"
        });

        const nodes = [
            {
                x: 170,
                y: -30,

                inputs: [{ id: "In" }],
                outputs: [],

                icon: "speaker-high",
                id: "output.master"
            },

            {
                x: -230,
                y: -30,

                inputs: [],
                outputs: [{ id: "Out" }],

                icon: "plugs-connected",
                id: "input.master"
            },

            {
                x: -230,
                y: 80,

                inputs: [],
                outputs: [{ id: "Out", type: "midi" }],

                icon: "piano-keys",
                id: "input.midi",
                label: "MIDI Input"
            }
        ]

        function generateRandomNodes(count, dispersity) {
            if(!dispersity) dispersity = count / 100;

            const nodes = [];
            for(let i = 0; i < count; i++){
                nodes.push({
                    label: `Node ${i}`,
                    icon: "acorn",
                    x: Math.random() * (800 * dispersity) - (400 * dispersity),
                    y: Math.random() * (800 * dispersity) - (400 * dispersity),
                    inputs: [{ id: "In 1" }, { id: "In 2" }],
                    outputs: [{ id: "Out 1" }, { id: "Out 2" }],
                    id: `node-${i}`
                });
            }
            return nodes;
        }

        function generateRandomConnections(nodes, connectionCount) {
            const connections = [];
            for(let i = 0; i < connectionCount; i++){
                const fromNode = nodes[Math.floor(Math.random() * nodes.length)];
                const toNode = nodes[Math.floor(Math.random() * nodes.length)];
                if(fromNode && toNode && fromNode !== toNode){
                    connections.push({
                        sourceNodeId: fromNode.id,
                        sourcePortId: fromNode.outputs[Math.floor(Math.random() * fromNode.outputs.length)].id,
                        targetNodeId: toNode.id,
                        targetPortId: toNode.inputs[Math.floor(Math.random() * toNode.inputs.length)].id
                    });
                }
            }
            return connections;
        }

        // const nodes = generateRandomNodes(100, 10);

        this.patcher = new LS.Patcher({
            parent: this.container,
            nodes,
            // connections: generateRandomConnections(nodes, 10)
        });

        this.patcher.loadPromise.then(() => {
            // const m = Array.from(this.patcher.iconEngine.font.nameMap.values());
            // for(const node of this.patcher.nodes) {
            //     node.icon = m[Math.floor(this.patcher.iconEngine.font.nameMap.size*Math.random())];
            // }
        });

        window.p = this.patcher;
    }
}