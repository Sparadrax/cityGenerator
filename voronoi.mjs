/**
 * Pure geometry helpers: clip convex polygons by half-planes, inset their edges, and sample closed perimeter paths. Coordinates use x/z for the ground plane.
 */
// Convex half-plane clipping: each site keeps points nearer to it than any other site.
/**
 * Keep the part of a convex polygon inside a half-plane, inserting edge intersections.
 *
 * @param polygon - Convex polygon with counterclockwise x/z vertices.
 * @param nx - X component of the half-plane normal.
 * @param nz - Z component of the half-plane normal.
 * @param limit - Maximum signed plane projection allowed by the clipping half-space.
 * @returns Vertices of the polygon remaining inside the clipping half-plane.
 */
export function clip(polygon, nx, nz, limit) {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const da = a.x * nx + a.z * nz - limit;
        const db = b.x * nx + b.z * nz - limit;
        if (da <= 1e-8) result.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
            const t = da / (da - db);
            result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        }
    }
    return result;
}
/**
 * Clip one region per site against the bisectors of every other site.
 *
 * @param sites - Seed coordinates that define nearest-site Voronoi regions.
 * @param boundary - Convex polygon that limits the 2D Voronoi regions.
 * @returns One clipped convex polygon per input site.
 */
export function voronoi(sites, boundary) {
    return sites.map((site, index) => {
        let cell = boundary;
        for (let j = 0; j < sites.length && cell.length; j++) {
            if (j === index) continue;
            const other = sites[j];
            const nx = other.x - site.x, nz = other.z - site.z;
            cell = clip(cell, nx, nz, (other.x ** 2 + other.z ** 2 - site.x ** 2 - site.z ** 2) / 2);
        }
        return cell;
    });
}
// Boundary vertices run counterclockwise; offset every edge inward by a fixed distance.
/**
 * Move every counterclockwise polygon edge inward by a fixed perpendicular distance.
 *
 * @param polygon - Convex polygon with counterclockwise x/z vertices.
 * @param distance - Perpendicular inward offset from every polygon edge, in world units.
 * @returns Vertices of the inset polygon; may be empty when the inset removes the whole region.
 */
export function inset(polygon, distance) {
    let result = polygon;
    for (let i = 0; i < polygon.length && result.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < 1e-8) continue;
        result = clip(result, dz, -dx, dz * a.x - dx * a.z - distance * length);
    }
    return result;
}
/**
 * Turn polygon edges into nonzero-length segments and compute the total perimeter.
 *
 * @param points - Polygon vertices or sample coordinates with x/z components.
 * @returns Nonzero-length perimeter segments and their total length.
 */
export function makePath(points) {
    const segments = points.map((a, i) => {
        const b = points[(i + 1) % points.length];
        return { a, b, length: Math.hypot(b.x - a.x, b.z - a.z) };
    }).filter(segment => segment.length > 1e-8);
    return { segments, length: segments.reduce((sum, segment) => sum + segment.length, 0) };
}
/**
 * Wrap a distance around the perimeter and interpolate within its containing segment.
 *
 * @param path - Closed perimeter segments and total path length.
 * @param distance - Travel distance around the closed perimeter, wrapping at the total path length.
 * @returns Interpolated x/z coordinates and heading at the wrapped perimeter distance.
 */
export function samplePath(path, distance) {
    let remaining = ((distance % path.length) + path.length) % path.length;
    for (const segment of path.segments) {
        if (remaining <= segment.length) {
            const t = remaining / segment.length;
            return { x: segment.a.x + (segment.b.x - segment.a.x) * t, z: segment.a.z + (segment.b.z - segment.a.z) * t, angle: Math.atan2(segment.b.x - segment.a.x, segment.b.z - segment.a.z) };
        }
        remaining -= segment.length;
    }
    const first = path.segments[0];
    return { ...first.a, angle: Math.atan2(first.b.x - first.a.x, first.b.z - first.a.z) };
}
