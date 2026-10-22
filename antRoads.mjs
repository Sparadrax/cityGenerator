/** Ant colony optimization chooses a district circuit over obstacle-aware gateway roads. */
import {createColony,iterate} from '../antColony/colony.mjs';

/**
 * Measure ground-plane distance.
 * @param a - First x/z point.
 * @param b - Second x/z point.
 * @returns Euclidean distance in world units.
 */
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

/**
 * Measure the nearest distance from a circle center to a road segment.
 * @param p - Circle center with x/z coordinates.
 * @param a - Segment start.
 * @param b - Segment end.
 * @returns Minimum center-to-segment distance.
 */
export function segmentDistance(p,a,b) {
    const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
    const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length)):0;
    return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}

/**
 * Find a collision-free polyline between two exterior gateway positions.
 * @param start - Exterior position of the first gateway.
 * @param end - Exterior position of the second gateway.
 * @param clusters - Neighborhoods enclosed by nonoverlapping bounding circles.
 * @returns Shortest visible-node route around district footprints, including both endpoints.
 */
function corridor(start,end,clusters) {
    const nodes=[start,end];
    for(const c of clusters)for(let i=0;i<16;i++) {
        const angle=i/16*Math.PI*2,radius=(c.radius+2)/Math.cos(Math.PI/16);
        nodes.push({x:c.center.x+Math.cos(angle)*radius,z:c.center.z+Math.sin(angle)*radius});
    }
    const adjacency=nodes.map(()=>[]);
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++) {
        if(clusters.some(c=>segmentDistance(c.center,nodes[i],nodes[j])<c.radius+1.5))continue;
        adjacency[i].push(j);adjacency[j].push(i);
    }
    const costs=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();costs[0]=0;
    for(let step=0;step<nodes.length;step++) {
        let current=-1;
        for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(current<0||costs[i]<costs[current]))current=i;
        if(current<0||!Number.isFinite(costs[current]))throw new Error('No safe road corridor found.');
        if(current===1)break;
        visited.add(current);
        for(const next of adjacency[current]) {
            const cost=costs[current]+distance(nodes[current],nodes[next]);
            if(cost<costs[next]){costs[next]=cost;previous[next]=current;}
        }
    }
    const route=[];for(let i=1;i>=0;i=previous[i])route.unshift(nodes[i]);
    return route;
}

/**
 * Select gateway roads by evolving pheromone-guided district tours.
 * @param clusters - Spaced Voronoi neighborhoods with convex boundaries and bounding radii.
 * @param random - Seeded random source returning values in [0, 1).
 * @returns Selected road polylines and optimization statistics from 60 ant-colony iterations.
 */
export function antRoads(clusters,random) {
    const routes=clusters.map(()=>[]),costs=clusters.map(()=>[]);
    for(let from=0;from<clusters.length;from++)for(let to=from+1;to<clusters.length;to++) {
        const a=clusters[from],b=clusters[to];let best=Infinity,gateways;
        for(const p of a.boundary)for(const q of b.boundary)if(distance(p,q)<best){best=distance(p,q);gateways=[p,q];}
        const exits=gateways.map((p,i)=>{
            const cluster=i===0?a:b,length=distance(p,cluster.center),radius=cluster.radius+3;
            return {x:cluster.center.x+(p.x-cluster.center.x)*radius/length,z:cluster.center.z+(p.z-cluster.center.z)*radius/length};
        });
        const points=[gateways[0],...corridor(exits[0],exits[1],clusters),gateways[1]];
        const cost=points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0);
        routes[from][to]=points;routes[to][from]=[...points].reverse();costs[from][to]=cost;costs[to][from]=cost;
    }
    const colony=createColony(clusters.map(c=>({x:c.center.x,y:c.center.z})),random);
    colony.distances=costs.map((row,i)=>clusters.map((_,j)=>i===j?.001:row[j]));
    let firstDistance;
    for(let generation=0;generation<60;generation++) {
        iterate(colony,{ants:40,evaporation:.3,alpha:1.2,beta:3});
        if(generation===0)firstDistance=colony.best.length;
    }
    const links=colony.best.route.map((from,i)=>{
        const to=colony.best.route[(i+1)%clusters.length];
        return {from,to,points:routes[from][to],cost:costs[from][to],pheromone:colony.pheromones[from][to]};
    });
    return {links,optimization:{iterations:colony.iteration,ants:40,firstDistance,bestDistance:colony.best.length}};
}
