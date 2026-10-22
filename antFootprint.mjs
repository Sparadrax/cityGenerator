/** Ant tours determine occupied city land before neighborhoods or streets are generated. */
import {createColony,iterate} from '../antColony/colony.mjs';
const directions=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

/**
 * Encode a hexagonal land parcel for lookup.
 * @param q - First axial hex coordinate.
 * @param r - Second axial hex coordinate.
 * @returns Stable parcel key.
 */
const key=(q,r)=>`${q},${r}`;

/**
 * Round interpolated axial coordinates to the nearest hex parcel.
 * @param q - Fractional first axial coordinate.
 * @param r - Fractional second axial coordinate.
 * @returns Integer q/r coordinates of the nearest hex.
 */
function roundHex(q,r){
    let x=Math.round(q),z=Math.round(r),y=Math.round(-q-r);
    const dx=Math.abs(x-q),dz=Math.abs(z-r),dy=Math.abs(y+q+r);
    if(dx>dy&&dx>dz)x=-y-z;else if(dz>dy)z=-x-y;
    return {q:x,r:z};
}

/**
 * Turn the colony's best tour into a broad, continuous footprint of buildable land.
 * @param random - Seeded random source returning values in [0, 1).
 * @param dotCount - Number of colony anchor dots, from 3 to 40; defaults to seven.
 * @returns Connected hex parcels and ant optimization statistics; streets are not part of this step.
 */
export function antFootprint(random,dotCount=7){
    if(!Number.isInteger(dotCount)||dotCount<3||dotCount>40)throw new RangeError('Ant colony dots must be an integer from 3 to 40.');
    const anchors=[],half=Math.max(3,Math.ceil(Math.sqrt(dotCount))),span=half*2+1;
    for(let attempt=0;anchors.length<dotCount&&attempt<dotCount*200;attempt++){
        const p={q:Math.floor(random()*span)-half,r:Math.floor(random()*span)-half};
        if(anchors.every(a=>Math.max(Math.abs(a.q-p.q),Math.abs(a.r-p.r),Math.abs(a.q+a.r-p.q-p.r))>=2))anchors.push(p);
    }
    // A bounded fallback avoids hanging if random placement runs out of well-spaced positions.
    for(let ring=half;anchors.length<dotCount;ring++){
        for(let q=-ring;q<=ring&&anchors.length<dotCount;q++)for(let r=-ring;r<=ring&&anchors.length<dotCount;r++){
            const p={q,r};
            if(anchors.every(a=>Math.max(Math.abs(a.q-p.q),Math.abs(a.r-p.r),Math.abs(a.q+a.r-p.q-p.r))>=2))anchors.push(p);
        }
    }
    const colony=createColony(anchors.map(p=>({x:Math.sqrt(3)*(p.q+p.r/2),y:1.5*p.r})),random);
    let firstDistance;
    for(let i=0;i<60;i++){iterate(colony,{ants:40,evaporation:.3,alpha:1.2,beta:3});if(i===0)firstDistance=colony.best.length;}
    const occupied=new Map();
    // Expand reinforced ant trails into land parcels, rather than drawing connecting roads.
    for(let i=0;i<anchors.length;i++){
        const a=anchors[colony.best.route[i]],b=anchors[colony.best.route[(i+1)%anchors.length]];
        const steps=Math.max(Math.abs(a.q-b.q),Math.abs(a.r-b.r),Math.abs(a.q+a.r-b.q-b.r))*3;
        const thickness=random()<.3?2:1;
        for(let step=0;step<=steps;step++){
            const p=roundHex(a.q+(b.q-a.q)*step/steps,a.r+(b.r-a.r)*step/steps);
            for(let dq=-thickness;dq<=thickness;dq++)for(let dr=-thickness;dr<=thickness;dr++)if(Math.abs(dq+dr)<=thickness){const q=p.q+dq,r=p.r+dr;occupied.set(key(q,r),{q,r});}
        }
    }
    const minQ=Math.min(...[...occupied.values()].map(p=>p.q))-1,maxQ=Math.max(...[...occupied.values()].map(p=>p.q))+1;
    const minR=Math.min(...[...occupied.values()].map(p=>p.r))-1,maxR=Math.max(...[...occupied.values()].map(p=>p.r))+1;
    // Fill enclosed trail loops with land so the city is not just a thin road-shaped ring.
    const outside=new Set([key(minQ,minR)]),queue=[{q:minQ,r:minR}];
    for(let i=0;i<queue.length;i++)for(const [dq,dr]of directions){const q=queue[i].q+dq,r=queue[i].r+dr,k=key(q,r);if(q<minQ||q>maxQ||r<minR||r>maxR||occupied.has(k)||outside.has(k))continue;outside.add(k);queue.push({q,r});}
    for(let q=minQ;q<=maxQ;q++)for(let r=minR;r<=maxR;r++)if(!outside.has(key(q,r)))occupied.set(key(q,r),{q,r});
    const tiles=[...occupied.values()],lookup=new Map(tiles.map((p,i)=>[key(p.q,p.r),i]));
    tiles.forEach(p=>{p.neighbors=directions.map(([dq,dr])=>lookup.get(key(p.q+dq,p.r+dr))).filter(i=>i!==undefined);});
    // Farthest-point seeds followed by simultaneous flood growth keep districts contiguous.
    const seeds=[0];
    while(seeds.length<5){let best=-1,score=-1;tiles.forEach((p,i)=>{if(seeds.includes(i))return;const nearest=Math.min(...seeds.map(s=>Math.hypot(p.q-tiles[s].q,p.r-tiles[s].r)));if(nearest>score){best=i;score=nearest;}});seeds.push(best);}
    const frontier=[];seeds.forEach((tile,id)=>{tiles[tile].district=id;frontier.push(tile);});
    for(let i=0;i<frontier.length;i++)for(const next of tiles[frontier[i]].neighbors)if(tiles[next].district===undefined){tiles[next].district=tiles[frontier[i]].district;frontier.push(next);}
    return {tiles,optimization:{dots:dotCount,iterations:60,ants:40,firstDistance,bestDistance:colony.best.length},route:colony.best.route.map(i=>anchors[i])};
}
