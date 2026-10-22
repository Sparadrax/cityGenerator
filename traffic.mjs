/**
 * Build one navigable street graph from block edges and district links. Cars follow graph routes to successive district destinations instead of closed block loops.
 */
/**
 * Measure Euclidean distance between two ground-plane points.
 *
 * @param a - First ground-plane point with x/z coordinates.
 * @param b - Second ground-plane point with x/z coordinates.
 * @returns Euclidean distance between the supplied points.
 */
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
/**
 * Merge block edges and gateway segments; split at existing junctions so T intersections are navigable.
 *
 * @param clusters - Generated neighborhoods containing boundaries, sites, and Voronoi cells.
 * @param links - Connecting road segments between generated districts.
 * @returns Object containing connected street nodes and one destination node per district.
 */
export function buildStreetGraph(clusters,links) {
    const segments=[];
    for(const cluster of clusters) for(const cell of cluster.cells) for(let i=0;i<cell.length;i++) segments.push({a:cell[i],b:cell[(i+1)%cell.length],district:cluster.id});
    for(const link of links) for(let i=1;i<link.points.length;i++) segments.push({a:link.points[i-1],b:link.points[i],district:null});
    const nodes=[], lookup=new Map();
    /**
     * Reuse a quantized street vertex or create a new graph node for that position.
     *
     * @param p - Point or vector being mapped, measured, or appended.
     * @returns Stable numeric node index for the supplied street position.
     */
    const nodeFor=p=>{
        const key=`${Math.round(p.x*10000)},${Math.round(p.z*10000)}`;
        if(!lookup.has(key)) {lookup.set(key,nodes.length);nodes.push({x:p.x,z:p.z,neighbors:new Set(),districts:new Set()});}
        return lookup.get(key);
    };
    segments.forEach(s=>{nodeFor(s.a);nodeFor(s.b);});
    // Split shared borders and gateway roads at every junction, including T junctions.
    for(const s of segments) {
        const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,length=Math.hypot(dx,dz);
        if(length<1e-6) continue;
        const hits=[];
        nodes.forEach((p,id)=>{
            const t=((p.x-s.a.x)*dx+(p.z-s.a.z)*dz)/(length*length);
            if(t>=-1e-6 && t<=1+1e-6 && Math.abs((p.x-s.a.x)*dz-(p.z-s.a.z)*dx)/length<1e-4) {
                hits.push({id,t});
                if(s.district!==null) p.districts.add(s.district);
            }
        });
        hits.sort((a,b)=>a.t-b.t);
        for(let i=1;i<hits.length;i++) {
            const a=hits[i-1].id,b=hits[i].id;
            if(a===b || distance(nodes[a],nodes[b])<1e-5) continue;
            nodes[a].neighbors.add(b);nodes[b].neighbors.add(a);
        }
    }
    const destinations=clusters.map(c=>nodes.reduce((best,p,i)=>p.districts.has(c.id) && (best<0 || distance(p,c.center)<distance(nodes[best],c.center))?i:best,-1));
    return {nodes,destinations};
}
/**
 * Use breadth-first search to recover a connected node route to the requested destination.
 *
 * @param graph - Street graph containing node coordinates, adjacency lists, and district destinations.
 * @param start - Starting point or node identifier for path search.
 * @param goal - Destination street-node identifier.
 * @returns Ordered street-node identifiers connecting start to goal; throws if no connection exists.
 */
export function findRoute(graph,start,goal) {
    const queue=[start],previous=new Map([[start,null]]);
    for(let i=0;i<queue.length && !previous.has(goal);i++) for(const next of graph.nodes[queue[i]].neighbors) {
        if(previous.has(next)) continue;
        previous.set(next,queue[i]);queue.push(next);
    }
    if(!previous.has(goal)) throw new Error('Disconnected city street network');
    const route=[];
    for(let id=goal;id!==null;id=previous.get(id)) route.unshift(id);
    return route;
}
/**
 * Start a vehicle at a district destination and immediately assign its first journey.
 *
 * @param graph - Street graph containing node coordinates, adjacency lists, and district destinations.
 * @param district - Starting district index for the vehicle.
 * @param stride - Step between neighborhood destinations; default one visits every region, even when district types repeat. Default: 1.
 * @returns Initialized vehicle state with its first inter-district journey assigned.
 */
export function createTrafficAgent(graph,district,stride=1) {
    const agent={node:graph.destinations[district],district,stride,route:[],edge:0,distance:0,visited:new Set([district])};
    nextTrip(graph,agent);
    return agent;
}
/**
 * Choose the next district in the agent's cycle and rebuild its route.
 *
 * @param graph - Street graph containing node coordinates, adjacency lists, and district destinations.
 * @param agent - Mutable vehicle state containing its current route, segment, and progress.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function nextTrip(graph,agent) {
    agent.district=(agent.district+agent.stride)%graph.destinations.length;
    agent.route=findRoute(graph,agent.node,graph.destinations[agent.district]);
    agent.edge=0;agent.distance=0;
}
/**
 * Consume travel distance across edges, carry leftovers through junctions, and taper lane offsets near turns.
 *
 * @param graph - Street graph containing node coordinates, adjacency lists, and district destinations.
 * @param agent - Mutable vehicle state containing its current route, segment, and progress.
 * @param travel - Distance to move along the street route, in world units.
 * @returns Current x/z position and heading after consuming the travel distance; updates the agent in place.
 */
export function advanceTraffic(graph,agent,travel) {
    // Consume leftover distance through junctions; never wrap a car around a block.
    for(let step=0;step<1000;step++) {
        if(agent.edge>=agent.route.length-1) {
            agent.node=agent.route.at(-1);agent.visited.add(agent.district);
            nextTrip(graph,agent);
        }
        const a=graph.nodes[agent.route[agent.edge]],b=graph.nodes[agent.route[agent.edge+1]];
        const length=distance(a,b),remaining=length-agent.distance;
        if(travel<remaining) {
            agent.distance+=travel;
            const t=agent.distance/length;
            const offset=.32*Math.min(1,agent.distance/.7,(length-agent.distance)/.7);
            return {x:a.x+(b.x-a.x)*t+(b.z-a.z)/length*offset,z:a.z+(b.z-a.z)*t-(b.x-a.x)/length*offset,angle:Math.atan2(b.x-a.x,b.z-a.z)};
        }
        travel-=remaining;agent.edge++;agent.distance=0;
    }
    throw new Error('Traffic traversal exceeded junction limit');
}
