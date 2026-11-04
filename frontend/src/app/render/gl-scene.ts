import { Mat4 } from './mat4';

/**
 * Doll-house cutaway shared by the point and mesh shaders: with `uCut` on, everything above the
 * ceiling cut and the wall facing the viewer (outside the room) is discarded, so the inside of
 * the room shows from an aerial view — the same rule as the pipeline renders (cutaway_mask).
 */
const CUTAWAY = `
uniform int uCut;
uniform vec4 uRoom;
uniform vec2 uCutDirection;
uniform vec2 uHeights;
bool cutAway(vec3 p) {
    if (uCut == 0) return false;
    if (p.y > uHeights.y) return true;
    if (uCutDirection == vec2(0.0)) return false;
    float along = dot(p.xz - uRoom.xy, uCutDirection);
    float extent = abs(uCutDirection.x) * uRoom.z + abs(uCutDirection.y) * uRoom.w;
    return along > extent - 0.4 && p.y > uHeights.x + 0.25;
}`;

const POINT_VS = `#version 300 es
in vec3 aPosition;
in vec4 aColor;
uniform mat4 uViewProjection;
uniform float uSize;
uniform float uScale;
out vec4 vColor;
out vec3 vWorld;
void main() {
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
    gl_PointSize = clamp(uSize * uScale / max(gl_Position.w, 1e-3), 1.0, 24.0);
    vColor = aColor;
    vWorld = aPosition;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec3 vWorld;
uniform float uAlpha;
${CUTAWAY}
out vec4 color;
void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    if (dot(d, d) > 1.0 || cutAway(vWorld)) discard;
    color = vec4(vColor.rgb, vColor.a * uAlpha);
}`;

const LINE_VS = `#version 300 es
in vec3 aPosition;
in vec4 aColor;
uniform mat4 uViewProjection;
out vec4 vColor;
void main() {
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
    vColor = aColor;
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
uniform float uAlpha;
out vec4 color;
void main() {
    color = vec4(vColor.rgb, vColor.a * uAlpha);
}`;

const MESH_VS = `#version 300 es
in vec3 aPosition;
in vec4 aColor;
uniform mat4 uViewProjection;
out vec3 vWorld;
out vec4 vColor;
void main() {
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
    vWorld = aPosition;
    vColor = aColor;
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec4 vColor;
uniform vec3 uEye;
${CUTAWAY}
out vec4 color;
void main() {
    if (cutAway(vWorld)) discard;
    // Vertex colours with a soft headlight from the flat normal (screen derivatives).
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float light = abs(dot(n, normalize(uEye - vWorld)));
    color = vec4(vColor.rgb * (0.72 + 0.28 * light), 1.0);
}`;

interface Program {
    program: WebGLProgram;
    uniforms: Map<string, WebGLUniformLocation | null>;
}

/** GPU buffers of one drawable. */
interface Drawable {
    vao: WebGLVertexArrayObject;
    buffers: WebGLBuffer[];
    count: number;
}

export interface ColoredGeometry {
    positions: Float32Array;
    /** RGB8 or RGBA8 per vertex. */
    colors: Uint8Array;
    channels: 3 | 4;
}

/** Room box and viewing direction of the cutaway; `null` turns it off. */
export interface Cutaway {
    /** Room centre and half extents on the floor plane: (x, z, half x, half z). */
    room: [number, number, number, number];
    /** Unit floor-plane direction from the room centre to the eye, or (0, 0) inside the room. */
    direction: [number, number];
    floor: number;
    ceiling: number;
}

/**
 * Small WebGL2 renderer of the viewer: coloured round points, coloured lines and a mesh with
 * vertex colours, the points and the mesh with an optional doll-house cutaway.
 */
export class GlScene {
    private readonly points: Program;
    private readonly lines: Program;
    private readonly mesh: Program;
    private readonly drawables = new Map<string, Drawable>();
    private cutaway: Cutaway | null = null;

    constructor(readonly gl: WebGL2RenderingContext) {
        this.points = this.compile(POINT_VS, POINT_FS);
        this.lines = this.compile(LINE_VS, LINE_FS);
        this.mesh = this.compile(MESH_VS, MESH_FS);
    }

    private compile(vertex: string, fragment: string): Program {
        const gl = this.gl;
        const program = gl.createProgram();
        for (const [type, source] of [
            [gl.VERTEX_SHADER, vertex],
            [gl.FRAGMENT_SHADER, fragment],
        ] as const) {
            const shader = gl.createShader(type) as WebGLShader;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compilation failed');
            }
            gl.attachShader(program, shader);
        }
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.bindAttribLocation(program, 1, 'aColor');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        }
        return { program, uniforms: new Map() };
    }

    private uniform(program: Program, name: string): WebGLUniformLocation | null {
        if (!program.uniforms.has(name)) {
            program.uniforms.set(name, this.gl.getUniformLocation(program.program, name));
        }
        return program.uniforms.get(name) ?? null;
    }

    /** Uploads (or replaces) a point or line set under `name`. */
    setColored(name: string, geometry: ColoredGeometry | null): void {
        this.remove(name);
        if (!geometry || geometry.positions.length === 0) return;
        const gl = this.gl;
        const vao = gl.createVertexArray() as WebGLVertexArrayObject;
        gl.bindVertexArray(vao);
        const position = this.attribute(0, geometry.positions, 3, gl.FLOAT, false);
        const color = this.attribute(1, geometry.colors, geometry.channels, gl.UNSIGNED_BYTE, true);
        if (geometry.channels === 3) gl.vertexAttrib4f(1, 1, 1, 1, 1);
        gl.bindVertexArray(null);
        this.drawables.set(name, {
            vao,
            buffers: [position, color],
            count: geometry.positions.length / 3,
        });
    }

    /** Uploads a mesh with RGB8 vertex colours. */
    setMesh(name: string, positions: Float32Array, colors: Uint8Array, indices: Uint32Array): void {
        this.remove(name);
        const gl = this.gl;
        const vao = gl.createVertexArray() as WebGLVertexArrayObject;
        gl.bindVertexArray(vao);
        const buffers = [
            this.attribute(0, positions, 3, gl.FLOAT, false),
            this.attribute(1, colors, 3, gl.UNSIGNED_BYTE, true),
        ];
        gl.vertexAttrib4f(1, 1, 1, 1, 1);
        const index = gl.createBuffer() as WebGLBuffer;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices as Uint32Array<ArrayBuffer>, gl.STATIC_DRAW);
        buffers.push(index);
        gl.bindVertexArray(null);
        this.drawables.set(name, { vao, buffers, count: indices.length });
    }

    setCutaway(cutaway: Cutaway | null): void {
        this.cutaway = cutaway;
    }

    has(name: string): boolean {
        return this.drawables.has(name);
    }

    remove(name: string): void {
        const drawable = this.drawables.get(name);
        if (!drawable) return;
        for (const buffer of drawable.buffers) this.gl.deleteBuffer(buffer);
        this.gl.deleteVertexArray(drawable.vao);
        this.drawables.delete(name);
    }

    private attribute(
        location: number,
        data: ArrayBufferView,
        size: number,
        type: number,
        normalized: boolean,
    ): WebGLBuffer {
        const gl = this.gl;
        const buffer = gl.createBuffer() as WebGLBuffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data as ArrayBufferView<ArrayBuffer>, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
        return buffer;
    }

    private applyCutaway(program: Program): void {
        const gl = this.gl;
        const cut = this.cutaway;
        gl.uniform1i(this.uniform(program, 'uCut'), cut ? 1 : 0);
        if (!cut) return;
        gl.uniform4fv(this.uniform(program, 'uRoom'), cut.room);
        gl.uniform2fv(this.uniform(program, 'uCutDirection'), cut.direction);
        gl.uniform2f(this.uniform(program, 'uHeights'), cut.floor, cut.ceiling);
    }

    /**
     * Draws points; `size` is the world-space diameter and `scale` the pixels per metre at unit
     * distance (viewport height / (2·tan(fov/2))).
     */
    drawPoints(name: string, viewProjection: Mat4, size: number, scale: number, alpha = 1): void {
        const drawable = this.drawables.get(name);
        if (!drawable) return;
        const gl = this.gl;
        gl.useProgram(this.points.program);
        gl.uniformMatrix4fv(this.uniform(this.points, 'uViewProjection'), false, viewProjection);
        gl.uniform1f(this.uniform(this.points, 'uSize'), size);
        gl.uniform1f(this.uniform(this.points, 'uScale'), scale);
        gl.uniform1f(this.uniform(this.points, 'uAlpha'), alpha);
        this.applyCutaway(this.points);
        gl.bindVertexArray(drawable.vao);
        gl.drawArrays(gl.POINTS, 0, drawable.count);
        gl.bindVertexArray(null);
    }

    drawLines(name: string, viewProjection: Mat4, alpha = 1): void {
        const drawable = this.drawables.get(name);
        if (!drawable) return;
        const gl = this.gl;
        gl.useProgram(this.lines.program);
        gl.uniformMatrix4fv(this.uniform(this.lines, 'uViewProjection'), false, viewProjection);
        gl.uniform1f(this.uniform(this.lines, 'uAlpha'), alpha);
        gl.bindVertexArray(drawable.vao);
        gl.drawArrays(gl.LINES, 0, drawable.count);
        gl.bindVertexArray(null);
    }

    drawMesh(name: string, viewProjection: Mat4, eye: number[]): void {
        const drawable = this.drawables.get(name);
        if (!drawable) return;
        const gl = this.gl;
        gl.useProgram(this.mesh.program);
        gl.uniformMatrix4fv(this.uniform(this.mesh, 'uViewProjection'), false, viewProjection);
        gl.uniform3fv(this.uniform(this.mesh, 'uEye'), eye);
        this.applyCutaway(this.mesh);
        gl.bindVertexArray(drawable.vao);
        gl.drawElements(gl.TRIANGLES, drawable.count, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
    }

    dispose(): void {
        for (const name of [...this.drawables.keys()]) this.remove(name);
    }
}
