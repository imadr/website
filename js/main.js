let canvas = document.getElementById("main-canvas");
let gl = canvas.getContext("webgl2");

function compile_shader(gl, shader_source, shader_type) {
    let shader = gl.createShader(shader_type);
    gl.shaderSource(shader, shader_source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("couldn't compile shader: " + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function link_shader_program(gl, vertex_shader_source, fragment_shader_source) {
    let vertex_shader = compile_shader(gl, vertex_shader_source, gl.VERTEX_SHADER);
    if (vertex_shader == null) return null;

    let fragment_shader = compile_shader(gl, fragment_shader_source, gl.FRAGMENT_SHADER);
    if (fragment_shader == null) return null;


    let shader_program = gl.createProgram();
    gl.attachShader(shader_program, vertex_shader);
    gl.attachShader(shader_program, fragment_shader);

    gl.linkProgram(shader_program);
    if (!gl.getProgramParameter(shader_program, gl.LINK_STATUS)) {
        console.error("couldn't link shader program: " + gl.getProgramInfoLog(shader_program));
        return null;
    }
    return shader_program;
}

function create_shader(gl, vertex_shader_source, fragment_shader_source) {
    let program = link_shader_program(gl, vertex_shader_source, fragment_shader_source);
    if (program == null) return null;
    let shader = {
        program: program,
        uniforms: {},
        attributes: {}
    };

    let n_uniforms = gl.getProgramParameter(shader.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n_uniforms; i++) {
        let uniform = gl.getActiveUniform(shader.program, i);
        shader.uniforms[uniform["name"]] = {
            type: uniform["type"],
            location: gl.getUniformLocation(shader.program, uniform["name"])
        };
    }

    let n_attributes = gl.getProgramParameter(shader.program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < n_attributes; i++) {
        let attribute = gl.getActiveAttrib(shader.program, i);
        shader.attributes[attribute["name"]] = {
            type: attribute["type"],
            location: gl.getAttribLocation(shader.program, attribute["name"])
        };
    }
    return shader;
}

function set_shader_uniform(gl, shader, uniform, value) {
    gl.useProgram(shader.program);
    if (!shader.uniforms.hasOwnProperty(uniform)) return;
    switch (shader.uniforms[uniform].type) {
        case gl.UNSIGNED_INT:
            gl.uniform1ui(shader.uniforms[uniform].location, value);
            break;
        case gl.INT:
            gl.uniform1i(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT:
            gl.uniform1f(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_VEC2:
            gl.uniform2fv(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_VEC3:
            gl.uniform3fv(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_VEC4:
            gl.uniform4fv(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_MAT4:
            gl.uniformMatrix4fv(shader.uniforms[uniform].location, false, value);
            break;
        default:
            console.error("set_shader_uniform: unknown uniform type");
    }
}

function create_vertex_buffer(gl, vertices, attributes, indices) {
    let vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    let vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    let attribs_stride = 0;
    for (let attribute of attributes) {
        attribs_stride += attribute.size;
    }

    let attrib_offset = 0;
    for (const [i, attribute] of attributes.entries()) {
        gl.vertexAttribPointer(i, attribute.size, gl.FLOAT, false,
            attribs_stride * Float32Array.BYTES_PER_ELEMENT,
            attrib_offset * Float32Array.BYTES_PER_ELEMENT);
        attrib_offset += attribute.size;
        gl.enableVertexAttribArray(i);
    }

    let ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.DYNAMIC_DRAW);
    draw_count = indices.length;

    return { vao: vao, vbo: vbo, ebo: ebo, draw_count: draw_count, vertices: vertices, indices: indices, attributes: attributes };
}

function resize_event() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
}

function update_camera_projection_matrix(camera, aspect_ratio) {
    let projection_matrix = perspective_projection(rad(camera.fov),
        aspect_ratio,
        camera.z_near,
        camera.z_far);
    camera.projection_matrix = projection_matrix;
}

function update_camera_orbit(camera) {
    let m = mat4_identity();
    m = mat4_mat4_mul(translate_3d(camera.orbit.pivot), m);
    m = mat4_mat4_mul(rotate_3d(euler_to_quat(camera.orbit.rotation)), m);
    m = mat4_mat4_mul(translate_3d([0, 0, camera.orbit.zoom]), m);
    camera.position = vec4_mat4_mul([0, 0, 0, 1], m).slice(0, 3);
    camera.view_matrix = mat4_invert(m);
}

let shader = create_shader(gl, `#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = position_attrib;
    normal = normal_attrib;
}`,
    `#version 300 es
precision highp float;

uniform vec3 color;
uniform sampler2D texture_uniform;

out vec4 frag_color;

in vec3 position;
in vec3 normal;

void main(){
    frag_color = vec4(0, 0, 0, 0.1);
}`);

let scene_boids = {
    camera: null,
    boids: [],
    boid_buffer: null,
    num_boids: 50,
    max_speed: 1.5,
    neighbor_radius: 10.0,
    separation_distance: 4.0,

    init: function (gl) {
        this.camera = {
            fov: 10,
            z_near: 0.1,
            z_far: 10000,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: { rotation: [0, 0, 0], pivot: [0, 0, 0], zoom: 300 },
        };

        this.boids = [];
        for (let i = 0; i < this.num_boids; i++) {
            this.boids.push({
                position: [
                    (Math.random() - 0.5) * 400,
                    (Math.random() - 0.5) * 400,
                    0.0
                ],
                velocity: [
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2,
                    0.0
                ],
                rotation: 0,
            });
        }

        this.create_boid_buffer(gl);
    },

    create_boid_buffer: function (gl) {
        const boid_vertices = [
            0, 0.7, 0, 0, 0, 1,
            -0.35, -0.35, 0, 0, 0, 1,
            0.35, -0.35, 0, 0, 0, 1,
        ];
        const boid_indices = [0, 1, 2];
        let vertices = [];
        let indices = [];
        let index_offset = 0;

        for (let b of this.boids) {
            const cos_r = Math.cos(b.rotation);
            const sin_r = Math.sin(b.rotation);
            const scale = 1.5;
            for (let i = 0; i < boid_vertices.length; i += 6) {
                let x = boid_vertices[i + 0] * scale;
                let y = boid_vertices[i + 1] * scale;
                const vx = x * cos_r - y * sin_r + b.position[0];
                const vy = x * sin_r + y * cos_r + b.position[1];
                const vz = 0;
                vertices.push(vx, vy, vz, 0, 0, 1);
            }
            for (let i = 0; i < boid_indices.length; i++) {
                indices.push(boid_indices[i] + index_offset);
            }
            index_offset += 3;
        }

        this.boid_buffer = create_vertex_buffer(gl, vertices, [
            { name: "position_attrib", size: 3 },
            { name: "normal_attrib", size: 3 },
        ], indices);
    },

    update_boids: function (delta_time) {
        for (let i = 0; i < this.boids.length; i++) {
            let b = this.boids[i];
            let alignment = [0, 0];
            let cohesion = [0, 0];
            let separation = [0, 0];
            let count = 0;

            for (let j = 0; j < this.boids.length; j++) {
                if (i === j) continue;
                let other = this.boids[j];
                let dx = other.position[0] - b.position[0];
                let dy = other.position[1] - b.position[1];
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < this.neighbor_radius && dist > 0) {
                    alignment[0] += other.velocity[0];
                    alignment[1] += other.velocity[1];
                    cohesion[0] += other.position[0];
                    cohesion[1] += other.position[1];

                    if (dist < this.separation_distance) {
                        separation[0] -= dx / dist;
                        separation[1] -= dy / dist;
                    }

                    count++;
                }
            }

            if (count > 0) {
                alignment[0] /= count;
                alignment[1] /= count;
                let mag = Math.hypot(alignment[0], alignment[1]);
                if (mag > 0) {
                    alignment[0] = (alignment[0] / mag) * this.max_speed;
                    alignment[1] = (alignment[1] / mag) * this.max_speed;
                }

                cohesion[0] = (cohesion[0] / count - b.position[0]);
                cohesion[1] = (cohesion[1] / count - b.position[1]);

                const align_weight = 0.001;
                const cohesion_weight = 0.003;
                const separation_weight = 0.02;

                b.velocity[0] += alignment[0] * align_weight + cohesion[0] * cohesion_weight + separation[0] * separation_weight;
                b.velocity[1] += alignment[1] * align_weight + cohesion[1] * cohesion_weight + separation[1] * separation_weight;
            }

            let speed = Math.hypot(b.velocity[0], b.velocity[1]);
            if (speed > this.max_speed) {
                b.velocity[0] = (b.velocity[0] / speed) * this.max_speed;
                b.velocity[1] = (b.velocity[1] / speed) * this.max_speed;
            }

            b.position[0] += b.velocity[0] * 0.5 * delta_time * 60;
            b.position[1] += b.velocity[1] * 0.5 * delta_time * 60;

            let wrap_x = 80;
            let wrap_y = 40;
            if (b.position[0] > wrap_x) b.position[0] = -wrap_x;
            if (b.position[0] < -wrap_x) b.position[0] = wrap_x;
            if (b.position[1] > wrap_y) b.position[1] = -wrap_y;
            if (b.position[1] < -wrap_y) b.position[1] = wrap_y;

            b.rotation = Math.atan2(b.velocity[1], b.velocity[0]) - Math.PI / 2;
        }
    },

    update: function (gl, width, height, delta_time) {
        this.update_boids(delta_time);
        this.create_boid_buffer(gl);
        update_camera_projection_matrix(this.camera, width / height);
        update_camera_orbit(this.camera);
        set_shader_uniform(gl, shader, "p", this.camera.projection_matrix);
        set_shader_uniform(gl, shader, "v", this.camera.view_matrix);
        set_shader_uniform(gl, shader, "m", mat4_identity());
        set_shader_uniform(gl, shader, "color", [0.2, 0.8, 1.0]);
        gl.useProgram(shader.program);
        gl.bindVertexArray(this.boid_buffer.vao);
        gl.drawElements(gl.TRIANGLES, this.boid_buffer.draw_count, gl.UNSIGNED_SHORT, 0);
    },
};

scene_boids.init(gl);

let current_scene = scene_boids;
let last_time = performance.now();

function update() {
    let current_time = performance.now();
    let delta_time = (current_time - last_time) / 1000;
    last_time = current_time;

    let rect = canvas.getBoundingClientRect();
    let width = rect.width;
    let height = rect.height;
    let left = rect.left - canvas.getBoundingClientRect().left;
    let bottom = canvas.clientHeight - (rect.bottom - canvas.getBoundingClientRect().top);

    gl.viewport(left, bottom, width, height);
    gl.scissor(left, bottom, width, height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    current_scene.update(gl, width, height, delta_time, current_time);

    requestAnimationFrame(update);
}

addEventListener("resize", () => resize_event());
resize_event();
requestAnimationFrame(update);