/**
 * District palette and earlier single-map grouping helpers. The current city generator imports the palette; neighborhood placement lives in neighborhoods.mjs.
 */
export const districtTypes = [
    { name: 'Downtown', color: '#ac8bea', height: 1, park: .1 },
    { name: 'Residential', color: '#72ddd0', height: .4, park: .2 },
    { name: 'Commercial', color: '#65a9ed', height: .7, park: .1 },
    { name: 'Industrial', color: '#e9aa64', height: .25, park: .05 },
    { name: 'Garden district', color: '#8bc56b', height: .3, park: .65 },
];
/**
 * Measure Euclidean distance between two ground-plane points.
 *
 * @param a - First ground-plane point with x/z coordinates.
 * @param b - Second ground-plane point with x/z coordinates.
 * @returns Euclidean distance between the supplied points.
 */
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
/**
 * Legacy single-map planner: choose spaced hubs, assign sites, and find links along cell edges.
 *
 * @param sites - Seed coordinates that define nearest-site Voronoi regions.
 * @param cells - Voronoi polygons corresponding to the input sites.
 * @returns District assignments, hub sites, and routes along the original single-map street graph.
 */
export function planDistricts(sites, cells) {
    // Farthest-point hubs keep every district represented, even on small maps.
    const hubs = [sites.reduce((a,b) => Math.hypot(a.x,a.z) < Math.hypot(b.x,b.z) ? a : b)];
    while (hubs.length < Math.min(districtTypes.length, sites.length)) {
        hubs.push(sites.filter(p => !hubs.includes(p)).reduce((a,b) =>
            Math.min(...hubs.map(h=>distance(a,h))) > Math.min(...hubs.map(h=>distance(b,h))) ? a : b));
    }
    const assignments = sites.map(p => hubs.reduce((best,h,i) => distance(p,h)<distance(p,hubs[best]) ? i : best,0));
    const nodes = new Map();
    /**
     * Quantize a ground-plane point to a stable graph lookup key.
     *
     * @param p - Point or vector being mapped, measured, or appended.
     * @returns Quantized coordinate string suitable for looking up a shared graph vertex.
     */
    const key = p => `${p.x.toFixed(5)},${p.z.toFixed(5)}`;
    for (const cell of cells) for (let i=0;i<cell.length;i++) {
        const a=cell[i], b=cell[(i+1)%cell.length], ka=key(a), kb=key(b);
        if(ka===kb) continue;
        if(!nodes.has(ka)) nodes.set(ka,{point:a,neighbors:new Set()});
        if(!nodes.has(kb)) nodes.set(kb,{point:b,neighbors:new Set()});
        nodes.get(ka).neighbors.add(kb);
        nodes.get(kb).neighbors.add(ka);
    }
    const anchors = hubs.map(h => [...nodes.keys()].reduce((a,b)=>distance(h,nodes.get(a).point)<distance(h,nodes.get(b).point)?a:b));
    const links=[];
    // Shortest street routes connect each outer district to Downtown.
    for(let i=1;i<anchors.length;i++) {
        const costs=new Map([[anchors[0],0]]), previous=new Map(), visited=new Set();
        while(true) {
            const current=[...costs.keys()].filter(k=>!visited.has(k)).sort((a,b)=>costs.get(a)-costs.get(b))[0];
            if(current===undefined || current===anchors[i]) break;
            visited.add(current);
            for(const next of nodes.get(current).neighbors) {
                const cost=costs.get(current)+distance(nodes.get(current).point,nodes.get(next).point);
                if(cost<(costs.get(next)??Infinity)) { costs.set(next,cost); previous.set(next,current); }
            }
        }
        if(!costs.has(anchors[i])) continue;
        const points=[];
        for(let k=anchors[i]; k!==undefined; k=previous.get(k)) points.unshift(nodes.get(k).point);
        links.push({from:0,to:i,points});
    }
    return {assignments,links,hubs};
}
