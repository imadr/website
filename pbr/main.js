// things to optimize :
// - scene_bulb : photons sin waves lag when full voltage
// - scene_electric_field : lag when regenerating field lines/vectors each frame on drag
// - make magnet rotate slower in scene_ampere
// - slow down photons from sun

let ctx = {};

function remap_value(value, from_min, from_max, to_min, to_max) {
    const normalized = (value - from_min) / (from_max - from_min)
    return to_min + (normalized * (to_max - to_min))
}

ctx.compile_shader = function(shader_source, shader_type){
    const gl = this.gl;
    let shader = gl.createShader(shader_type);
    gl.shaderSource(shader, shader_source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
        console.error("couldn't compile shader: "+gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

ctx.link_shader_program = function(vertex_shader_source, fragment_shader_source){
    const gl = this.gl;
    let vertex_shader = this.compile_shader(vertex_shader_source, gl.VERTEX_SHADER);
    if(vertex_shader == null) return null;

    let fragment_shader = this.compile_shader(fragment_shader_source, gl.FRAGMENT_SHADER);
    if(fragment_shader == null) return null;


    let shader_program = gl.createProgram();
    gl.attachShader(shader_program, vertex_shader);
    gl.attachShader(shader_program, fragment_shader);

    gl.linkProgram(shader_program);
    if(!gl.getProgramParameter(shader_program, gl.LINK_STATUS)){
        console.error("couldn't link shader program: "+gl.getProgramInfoLog(shader_program));
        return null;
    }
    return shader_program;
}

ctx.create_shader = function(vertex_shader_source, fragment_shader_source){
    const gl = this.gl;
    let program = this.link_shader_program(vertex_shader_source, fragment_shader_source);
    if(program == null) return null;
    let shader = {
        program: program,
        uniforms: {},
        attributes: {}
    };

    let n_uniforms = gl.getProgramParameter(shader.program, gl.ACTIVE_UNIFORMS);
    for(let i = 0; i < n_uniforms; i++){
        let uniform = gl.getActiveUniform(shader.program, i);
        shader.uniforms[uniform["name"]] = {
            type: uniform["type"],
            location: gl.getUniformLocation(shader.program, uniform["name"])
        };
    }

    let n_attributes = gl.getProgramParameter(shader.program, gl.ACTIVE_ATTRIBUTES);
    for(let i = 0; i < n_attributes; i++){
        let attribute = gl.getActiveAttrib(shader.program, i);
        shader.attributes[attribute["name"]] = {
            type: attribute["type"],
            location: gl.getAttribLocation(shader.program, attribute["name"])
        };
    }
    return shader;
}

ctx.set_shader_uniform = function(shader, uniform, value){
    const gl = this.gl;
    gl.useProgram(shader.program);
    if(!shader.uniforms.hasOwnProperty(uniform)) return;
    switch(shader.uniforms[uniform].type){
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

ctx.create_vertex_buffer = function(vertices, attributes, indices){
    const gl = this.gl;
    let vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    let vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    let attribs_stride = 0;
    for(let attribute of attributes){
        attribs_stride += attribute.size;
    }

    let attrib_offset = 0;
    for(const [i, attribute] of attributes.entries()){
        gl.vertexAttribPointer(i, attribute.size, gl.FLOAT, false,
                               attribs_stride*Float32Array.BYTES_PER_ELEMENT,
                               attrib_offset*Float32Array.BYTES_PER_ELEMENT);
        attrib_offset += attribute.size;
        gl.enableVertexAttribArray(i);
    }

    let ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.DYNAMIC_DRAW);
    draw_count = indices.length;

    return {vao: vao, vbo: vbo, ebo: ebo, draw_count: draw_count, vertices: vertices, indices: indices, attributes: attributes};
}

function update_camera_projection_matrix(camera, aspect_ratio){
    let projection_matrix = perspective_projection(rad(camera.fov),
                                aspect_ratio,
                                camera.z_near,
                                camera.z_far);
    camera.projection_matrix = projection_matrix;
}

function update_camera_orbit(camera){
    let m = mat4_identity();
        m = mat4_mat4_mul(translate_3d(camera.orbit.pivot), m);
        m = mat4_mat4_mul(rotate_3d(euler_to_quat(camera.orbit.rotation)), m);
        m = mat4_mat4_mul(translate_3d([0, 0, camera.orbit.zoom]), m);
    camera.position = vec4_mat4_mul([0, 0, 0, 1], m).slice(0, 3);
    camera.view_matrix = mat4_invert(m);
}

function line_intersection(p1, p2, p3, p4) {
    let a1 = p2[1] - p1[1];
    let b1 = p1[0] - p2[0];
    let c1 = a1 * p1[0] + b1 * p1[1];

    let a2 = p4[1] - p3[1];
    let b2 = p3[0] - p4[0];
    let c2 = a2 * p3[0] + b2 * p3[1];

    let determinant = a1 * b2 - a2 * b1;

    if (determinant == 0) return null;

    let x = (b2 * c1 - b1 * c2) / determinant;
    let y = (a1 * c2 - a2 * c1) / determinant;

    return [x, y];
}

function create_line(points, thickness, use_miter = true) {
    thickness /= 2;
    let vertices = [];
    let indices = [];
    let vertex_count = 0;

    if (points.length >= 2) {
        let p1 = points[0];
        let p2 = points[1];
        let dir = vec2_normalize(vec2_sub(p2, p1));
        let normal = [-dir[1], dir[0]];

        vertices.push(
            p1[0] + normal[0] * thickness, p1[1] + normal[1] * thickness, 0, 0, 0, 1,
            p1[0] - normal[0] * thickness, p1[1] - normal[1] * thickness, 0, 0, 0, 1
        );
        vertex_count += 2;
    }

    for (let i = 1; i < points.length - 1; i++) {
        let prev = points[i - 1];
        let curr = points[i];
        let next = points[i + 1];

        let dir1 = vec2_normalize(vec2_sub(curr, prev));
        let dir2 = vec2_normalize(vec2_sub(next, curr));
        let normal1 = [-dir1[1], dir1[0]];
        let normal2 = [-dir2[1], dir2[0]];

        if (use_miter) {
            let tangent = vec2_normalize(vec2_add(dir1, dir2));
            let miter = [-tangent[1], tangent[0]];
            let dot = normal1[0] * normal2[0] + normal1[1] * normal2[1];
            let miter_length = thickness / Math.sqrt((1 + dot) / 2);

            vertices.push(
                curr[0] + miter[0] * miter_length, curr[1] + miter[1] * miter_length, 0, 0, 0, 1,
                curr[0] - miter[0] * miter_length, curr[1] - miter[1] * miter_length, 0, 0, 0, 1
            );

            indices.push(
                vertex_count - 2, vertex_count - 1, vertex_count,
                vertex_count - 1, vertex_count + 1, vertex_count
            );

            vertex_count += 2;
        } else {
            vertices.push(
                curr[0] + normal1[0] * thickness, curr[1] + normal1[1] * thickness, 0, 0, 0, 1,
                curr[0] - normal1[0] * thickness, curr[1] - normal1[1] * thickness, 0, 0, 0, 1,
                curr[0] + normal2[0] * thickness, curr[1] + normal2[1] * thickness, 0, 0, 0, 1,
                curr[0] - normal2[0] * thickness, curr[1] - normal2[1] * thickness, 0, 0, 0, 1
            );

            indices.push(
                vertex_count - 2, vertex_count - 1, vertex_count,
                vertex_count - 1, vertex_count + 1, vertex_count,
                vertex_count, vertex_count + 1, vertex_count + 2,
                vertex_count + 1, vertex_count + 3, vertex_count + 2
            );

            vertex_count += 4;
        }
    }

    if (points.length >= 2) {
        let p1 = points[points.length - 2];
        let p2 = points[points.length - 1];
        let dir = vec2_normalize(vec2_sub(p2, p1));
        let normal = [-dir[1], dir[0]];

        vertices.push(
            p2[0] + normal[0] * thickness, p2[1] + normal[1] * thickness, 0, 0, 0, 1,
            p2[0] - normal[0] * thickness, p2[1] - normal[1] * thickness, 0, 0, 0, 1
        );

        indices.push(
            vertex_count - 2, vertex_count - 1, vertex_count,
            vertex_count - 1, vertex_count + 1, vertex_count
        );

        vertex_count += 2;
    }

    return {vertices: vertices, indices: indices};
}

function create_line_dashed(points, thickness, dash_length = 0.1, gap_length = 0.1, use_miter = true) {
    let dashed_points = [];

    for (let i = 1; i < points.length; i++) {
        let p1 = points[i - 1];
        let p2 = points[i];
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        let segment_length = Math.sqrt(dx * dx + dy * dy);
        let dir = [dx / segment_length, dy / segment_length];
        let distance = 0;

        while (distance + dash_length <= segment_length) {
            let dash_start = [
                p1[0] + dir[0] * distance,
                p1[1] + dir[1] * distance
            ];
            dashed_points.push(dash_start);

            let dash_end = [
                p1[0] + dir[0] * (distance + dash_length),
                p1[1] + dir[1] * (distance + dash_length)
            ];
            dashed_points.push(dash_end);

            distance += dash_length + gap_length;
        }

        if (distance < segment_length && segment_length - distance > 0.01) {
            let remaining = segment_length - distance;
            if (remaining <= dash_length) {
                dashed_points.push([
                    p1[0] + dir[0] * distance,
                    p1[1] + dir[1] * distance
                ]);
                dashed_points.push([
                    p1[0] + dir[0] * segment_length,
                    p1[1] + dir[1] * segment_length
                ]);
            }
        }
    }

    let all_vertices = [];
    let all_indices = [];
    let vertex_offset = 0;

    for (let i = 0; i < dashed_points.length; i += 2) {
        if (i + 1 < dashed_points.length) {
            let dash = [dashed_points[i], dashed_points[i + 1]];
            let line = create_line(dash, thickness, use_miter);
            all_vertices.push(...line.vertices);

            for (let j = 0; j < line.indices.length; j++) {
                all_indices.push(line.indices[j] + vertex_offset);
            }

            vertex_offset += line.vertices.length / 6;
        }
    }

    return { vertices: all_vertices, indices: all_indices };
}

function get_rotation_matrix(direction) {
    let up = [0, 1, 0];
    let right = vec3_normalize(vec3_cross(direction, up));
    if (vec3_magnitude(right) < 0.001) {
        right = [1, 0, 0];
    }
    up = vec3_normalize(vec3_cross(right, direction));

    return [
        right[0], right[1], right[2],
        up[0], up[1], up[2],
        direction[0], direction[1], direction[2]
    ];
}

function generate_circle(radius, segments) {
    let circle = [];
    for (let i = 0; i < segments; i++) {
        let angle = (i / segments) * Math.PI * 2;
        circle.push([
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
        ]);
    }
    return circle;
}

function transform_point(point, rot_mat, position) {
    let x = point[0];
    let y = point[1];
    return [
        x * rot_mat[0] + y * rot_mat[3] + position[0],
        x * rot_mat[1] + y * rot_mat[4] + position[1],
        x * rot_mat[2] + y * rot_mat[5] + position[2]
    ];
}

function create_line_3d(points, radius, segments) {
    let vertices = [];
    let indices = [];
    let vertex_count = 0;
    let circle = generate_circle(radius, segments);
    let prev_circle_vertices = null;

    let start = points[0];
    let direction = vec3_normalize(vec3_sub(points[1], points[0]));
    let rot_mat = get_rotation_matrix(direction);

    vertices.push(start[0], start[1], start[2], -direction[0], -direction[1], -direction[2]);
    let center_start = vertex_count++;

    let start_circle_vertices = [];
    for (let j = 0; j < segments; j++) {
        let transformed = transform_point(circle[j], rot_mat, start);
        vertices.push(transformed[0], transformed[1], transformed[2], -direction[0], -direction[1], -direction[2]);
        start_circle_vertices.push(vertex_count++);
    }

    for (let j = 0; j < segments; j++) {
        let next_j = (j + 1) % segments;
        indices.push(center_start, start_circle_vertices[j], start_circle_vertices[next_j]);
    }

    for (let i = 0; i < points.length - 1; i++) {
        start = points[i];
        let end = points[i + 1];
        direction = vec3_normalize(vec3_sub(end, start));
        rot_mat = get_rotation_matrix(direction);
        let current_circle_vertices = [];

        for (let j = 0; j < segments; j++) {
            let transformed_start = transform_point(circle[j], rot_mat, start);
            let normal = vec3_normalize(transform_point([circle[j][0] / radius, circle[j][1] / radius, 0], rot_mat, [0, 0, 0]));
            vertices.push(transformed_start[0], transformed_start[1], transformed_start[2], normal[0], normal[1], normal[2]);
            current_circle_vertices.push(vertex_count++);
        }

        for (let j = 0; j < segments; j++) {
            let next_j = (j + 1) % segments;
            let v0 = current_circle_vertices[j];
            let v1 = current_circle_vertices[next_j];
            if (prev_circle_vertices) {
                let v2 = prev_circle_vertices[j];
                let v3 = prev_circle_vertices[next_j];
                indices.push(v2, v0, v3);
                indices.push(v3, v0, v1);
            }
        }

        for (let j = 0; j < segments; j++) {
            let transformed_end = transform_point(circle[j], rot_mat, end);
            let normal = vec3_normalize(transform_point([circle[j][0] / radius, circle[j][1] / radius, 0], rot_mat, [0, 0, 0]));
            vertices.push(transformed_end[0], transformed_end[1], transformed_end[2], normal[0], normal[1], normal[2]);
            current_circle_vertices.push(vertex_count++);
        }

        for (let j = 0; j < segments; j++) {
            let next_j = (j + 1) % segments;
            let v0 = current_circle_vertices[j];
            let v1 = current_circle_vertices[next_j];
            let v2 = current_circle_vertices[j + segments];
            let v3 = current_circle_vertices[next_j + segments];
            indices.push(v0, v2, v1);
            indices.push(v1, v2, v3);
        }
        prev_circle_vertices = current_circle_vertices.slice(segments);
    }

    let end = points[points.length - 1];
    direction = vec3_normalize(vec3_sub(points[points.length - 1], points[points.length - 2]));
    rot_mat = get_rotation_matrix(direction);

    vertices.push(end[0], end[1], end[2], direction[0], direction[1], direction[2]);
    let center_end = vertex_count++;

    let end_circle_vertices = prev_circle_vertices;

    for (let j = 0; j < segments; j++) {
        let idx = end_circle_vertices[j] * 6;
        vertices[idx + 3] = direction[0];
        vertices[idx + 4] = direction[1];
        vertices[idx + 5] = direction[2];
    }

    for (let j = 0; j < segments; j++) {
        let next_j = (j + 1) % segments;
        indices.push(center_end, end_circle_vertices[next_j], end_circle_vertices[j]);
    }

    return {vertices: vertices, indices: indices};
}

function create_arrow_3d(points, radius, segments, arrow_length = 0.15, arrow_radius = 0.07) {
    let arrow_base = points[points.length - 1];
    let pre_base = points[points.length - 2];
    let direction = vec3_normalize(vec3_sub(arrow_base, pre_base));
    let arrow_tip = vec3_add(arrow_base, vec3_scale(direction, arrow_length));

    let modified_points = [...points.slice(0, -1), arrow_base];
    let line_geometry = create_line_3d(modified_points, radius, segments);
    let vertices = line_geometry.vertices;
    let indices = line_geometry.indices;
    let vertex_count = vertices.length / 6;

    let circle = generate_circle(arrow_radius, segments);
    let rot_mat = get_rotation_matrix(direction);

    let base_vertices = [];
    for (let i = 0; i < segments; i++) {
        let transformed = transform_point(circle[i], rot_mat, arrow_base);
        vertices.push(
            transformed[0], transformed[1], transformed[2],
            circle[i][0] / arrow_radius, circle[i][1] / arrow_radius, 0
        );
        base_vertices.push(vertex_count++);
    }

    vertices.push(arrow_tip[0], arrow_tip[1], arrow_tip[2], 0, 0, 1);
    let tip_vertex = vertex_count++;

    for (let i = 0; i < segments; i++) {
        let next = (i + 1) % segments;
        indices.push(
            base_vertices[i],
            tip_vertex,
            base_vertices[next]
        );
    }

    let reversed_base_vertices = base_vertices.slice().reverse();

    let base_center_normal = vec3_scale(direction, -1);
    vertices.push(
        arrow_base[0], arrow_base[1], arrow_base[2],
        base_center_normal[0], base_center_normal[1], base_center_normal[2]
    );
    let base_center_index = vertex_count++;

    for (let i = 0; i < segments; i++) {
        let next = (i + 1) % segments;
        indices.push(
            base_center_index,
            reversed_base_vertices[next],
            reversed_base_vertices[i]
        );
    }

    return { vertices: vertices, indices: indices };
}

function calculate_normal(x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    let ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
    let vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;

    let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return { x: nx / len, y: ny / len, z: nz / len };
}

function calculate_tangent(v1, v2, v3, normal) {
    let x1 = v2.x - v1.x;
    let y1 = v2.y - v1.y;
    let z1 = v2.z - v1.z;

    let x2 = v3.x - v1.x;
    let y2 = v3.y - v1.y;
    let z2 = v3.z - v1.z;

    let s1 = v2.u - v1.u;
    let t1 = v2.v - v1.v;
    let s2 = v3.u - v1.u;
    let t2 = v3.v - v1.v;

    let r = 1.0 / (s1 * t2 - s2 * t1);

    let tx = (t2 * x1 - t1 * x2) * r;
    let ty = (t2 * y1 - t1 * y2) * r;
    let tz = (t2 * z1 - t1 * z2) * r;

    let dot = tx * normal.x + ty * normal.y + tz * normal.z;
    tx -= normal.x * dot;
    ty -= normal.y * dot;
    tz -= normal.z * dot;

    let len = Math.sqrt(tx * tx + ty * ty + tz * tz);
    return { x: tx / len, y: ty / len, z: tz / len };
}

function create_uv_sphere_tangent(radius, latitudes, longitudes, smooth = true) {
    let vertices = [];
    let indices = [];

    for (let lat = 0; lat <= latitudes; lat++) {
        let theta = lat * Math.PI / latitudes;
        let sin_theta = Math.sin(theta);
        let cos_theta = Math.cos(theta);

        for (let lon = 0; lon <= longitudes; lon++) {
            let phi = lon * 2 * Math.PI / longitudes;
            let sin_phi = Math.sin(phi);
            let cos_phi = Math.cos(phi);

            let x = radius * sin_theta * cos_phi;
            let y = radius * cos_theta;
            let z = radius * sin_theta * sin_phi;

            let u = 1 - (lon / longitudes);
            let v = 1 - (lat / latitudes);

            let nx = sin_theta * cos_phi;
            let ny = cos_theta;
            let nz = sin_theta * sin_phi;

            let tx = -sin_phi;
            let ty = 0;
            let tz = cos_phi;

            vertices.push(x, y, z, nx, ny, nz, u, v, tx, ty, tz);
        }
    }

    if (smooth) {
        for (let lat = 0; lat < latitudes; lat++) {
            for (let lon = 0; lon < longitudes; lon++) {
                let first = (lat * (longitudes + 1)) + lon;
                let second = first + longitudes + 1;

                indices.push(first, first + 1, second);
                indices.push(second, first + 1, second + 1);
            }
        }
    } else {
        let flat_vertices = [];

        for (let lat = 0; lat < latitudes; lat++) {
            for (let lon = 0; lon < longitudes; lon++) {
                let first = (lat * (longitudes + 1)) + lon;
                let second = first + longitudes + 1;
                let third = first + 1;
                let fourth = second + 1;

                let v1 = { x: vertices[first * 11], y: vertices[first * 11 + 1], z: vertices[first * 11 + 2], u: vertices[first * 11 + 6], v: vertices[first * 11 + 7] };
                let v2 = { x: vertices[second * 11], y: vertices[second * 11 + 1], z: vertices[second * 11 + 2], u: vertices[second * 11 + 6], v: vertices[second * 11 + 7] };
                let v3 = { x: vertices[third * 11], y: vertices[third * 11 + 1], z: vertices[third * 11 + 2], u: vertices[third * 11 + 6], v: vertices[third * 11 + 7] };
                let v4 = { x: vertices[fourth * 11], y: vertices[fourth * 11 + 1], z: vertices[fourth * 11 + 2], u: vertices[fourth * 11 + 6], v: vertices[fourth * 11 + 7] };

                let normal1 = calculate_normal(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
                let tangent1 = calculate_tangent(v1, v2, v3, normal1);

                flat_vertices.push(v1.x, v1.y, v1.z, normal1.x, normal1.y, normal1.z, v1.u, v1.v, tangent1.x, tangent1.y, tangent1.z,
                                   v2.x, v2.y, v2.z, normal1.x, normal1.y, normal1.z, v2.u, v2.v, tangent1.x, tangent1.y, tangent1.z,
                                   v3.x, v3.y, v3.z, normal1.x, normal1.y, normal1.z, v3.u, v3.v, tangent1.x, tangent1.y, tangent1.z);

                let normal2 = calculate_normal(v2.x, v2.y, v2.z, v4.x, v4.y, v4.z, v3.x, v3.y, v3.z);
                let tangent2 = calculate_tangent(v2, v4, v3, normal2);

                flat_vertices.push(v2.x, v2.y, v2.z, normal2.x, normal2.y, normal2.z, v2.u, v2.v, tangent2.x, tangent2.y, tangent2.z,
                                   v4.x, v4.y, v4.z, normal2.x, normal2.y, normal2.z, v4.u, v4.v, tangent2.x, tangent2.y, tangent2.z,
                                   v3.x, v3.y, v3.z, normal2.x, normal2.y, normal2.z, v3.u, v3.v, tangent2.x, tangent2.y, tangent2.z);
            }
        }

        vertices = flat_vertices;
        for (let i = 0; i < vertices.length / 11; i++) {
            indices.push(i);
        }
    }

    return { vertices, indices };
}

function create_uv_sphere(radius, latitudes, longitudes, smooth = true) {
    let vertices = [];
    let indices = [];

    for (let lat = 0; lat <= latitudes; lat++) {
        let theta = lat * Math.PI / latitudes;
        let sin_theta = Math.sin(theta);
        let cos_theta = Math.cos(theta);

        for (let lon = 0; lon <= longitudes; lon++) {
            let phi = lon * 2 * Math.PI / longitudes;
            let sin_phi = Math.sin(phi);
            let cos_phi = Math.cos(phi);

            let x = radius * sin_theta * cos_phi;
            let y = radius * cos_theta;
            let z = radius * sin_theta * sin_phi;

            let u = 1 - (lon / longitudes);
            let v = 1 - (lat / latitudes);

            let nx = sin_theta * cos_phi;
            let ny = cos_theta;
            let nz = sin_theta * sin_phi;

            vertices.push(x, y, z, nx, ny, nz, u, v);
        }
    }

    if (smooth) {
        for (let lat = 0; lat < latitudes; lat++) {
            for (let lon = 0; lon < longitudes; lon++) {
                let first = (lat * (longitudes + 1)) + lon;
                let second = first + longitudes + 1;

                indices.push(first, first + 1, second);
                indices.push(second, first + 1, second + 1);
            }
        }
    } else {
        let flat_vertices = [];

        for (let lat = 0; lat < latitudes; lat++) {
            for (let lon = 0; lon < longitudes; lon++) {
                let first = (lat * (longitudes + 1)) + lon;
                let second = first + longitudes + 1;
                let third = first + 1;
                let fourth = second + 1;

                let v1 = { x: vertices[first * 8], y: vertices[first * 8 + 1], z: vertices[first * 8 + 2], u: vertices[first * 8 + 6], v: vertices[first * 8 + 7] };
                let v2 = { x: vertices[second * 8], y: vertices[second * 8 + 1], z: vertices[second * 8 + 2], u: vertices[second * 8 + 6], v: vertices[second * 8 + 7] };
                let v3 = { x: vertices[third * 8], y: vertices[third * 8 + 1], z: vertices[third * 8 + 2], u: vertices[third * 8 + 6], v: vertices[third * 8 + 7] };
                let v4 = { x: vertices[fourth * 8], y: vertices[fourth * 8 + 1], z: vertices[fourth * 8 + 2], u: vertices[fourth * 8 + 6], v: vertices[fourth * 8 + 7] };

                let normal1 = calculate_normal(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
                flat_vertices.push(v1.x, v1.y, v1.z, normal1.x, normal1.y, normal1.z, v1.u, v1.v,
                                  v2.x, v2.y, v2.z, normal1.x, normal1.y, normal1.z, v2.u, v2.v,
                                  v3.x, v3.y, v3.z, normal1.x, normal1.y, normal1.z, v3.u, v3.v);

                let normal2 = calculate_normal(v2.x, v2.y, v2.z, v4.x, v4.y, v4.z, v3.x, v3.y, v3.z);
                flat_vertices.push(v2.x, v2.y, v2.z, normal2.x, normal2.y, normal2.z, v2.u, v2.v,
                                  v4.x, v4.y, v4.z, normal2.x, normal2.y, normal2.z, v4.u, v4.v,
                                  v3.x, v3.y, v3.z, normal2.x, normal2.y, normal2.z, v3.u, v3.v);
            }
        }

        vertices = flat_vertices;
        for (let i = 0; i < vertices.length / 8; i++) {
            indices.push(i);
        }
    }

    return { vertices, indices };
}

function create_uv_hemisphere(radius, latitudes, longitudes, smooth = true){
    let vertices = [];
    let indices = [];

    for (let lat = 0; lat <= latitudes / 2; lat++) {
        let theta = lat * Math.PI / latitudes;
        let sin_theta = Math.sin(theta);
        let cos_theta = Math.cos(theta);

        for (let lon = 0; lon <= longitudes; lon++) {
            let phi = lon * 2 * Math.PI / longitudes;
            let sin_phi = Math.sin(phi);
            let cos_phi = Math.cos(phi);

            let x = radius * sin_theta * cos_phi;
            let y = radius * cos_theta;
            let z = radius * sin_theta * sin_phi;

            let u = 1 - (lon / longitudes);
            let v = 1 - (lat / (latitudes / 2));

            let nx = sin_theta * cos_phi;
            let ny = cos_theta;
            let nz = sin_theta * sin_phi;

            vertices.push(x, y, z, nx, ny, nz, u, v);
        }
    }

    if (smooth) {
        for (let lat = 0; lat < latitudes / 2; lat++) {
            for (let lon = 0; lon < longitudes; lon++) {
                let first = (lat * (longitudes + 1)) + lon;
                let second = first + longitudes + 1;

                indices.push(first, first + 1, second);
                indices.push(second, first + 1, second + 1);
            }
        }
    } else {
        let flat_vertices = [];

        for (let lat = 0; lat < latitudes / 2; lat++) {
            for (let lon = 0; lon < longitudes; lon++) {
                let first = (lat * (longitudes + 1)) + lon;
                let second = first + longitudes + 1;
                let third = first + 1;
                let fourth = second + 1;

                let v1 = { x: vertices[first * 8], y: vertices[first * 8 + 1], z: vertices[first * 8 + 2], u: vertices[first * 8 + 6], v: vertices[first * 8 + 7] };
                let v2 = { x: vertices[second * 8], y: vertices[second * 8 + 1], z: vertices[second * 8 + 2], u: vertices[second * 8 + 6], v: vertices[second * 8 + 7] };
                let v3 = { x: vertices[third * 8], y: vertices[third * 8 + 1], z: vertices[third * 8 + 2], u: vertices[third * 8 + 6], v: vertices[third * 8 + 7] };
                let v4 = { x: vertices[fourth * 8], y: vertices[fourth * 8 + 1], z: vertices[fourth * 8 + 2], u: vertices[fourth * 8 + 6], v: vertices[fourth * 8 + 7] };

                let normal1 = calculate_normal(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
                flat_vertices.push(v1.x, v1.y, v1.z, normal1.x, normal1.y, normal1.z, v1.u, v1.v,
                                  v2.x, v2.y, v2.z, normal1.x, normal1.y, normal1.z, v2.u, v2.v,
                                  v3.x, v3.y, v3.z, normal1.x, normal1.y, normal1.z, v3.u, v3.v);

                let normal2 = calculate_normal(v2.x, v2.y, v2.z, v4.x, v4.y, v4.z, v3.x, v3.y, v3.z);
                flat_vertices.push(v2.x, v2.y, v2.z, normal2.x, normal2.y, normal2.z, v2.u, v2.v,
                                  v4.x, v4.y, v4.z, normal2.x, normal2.y, normal2.z, v4.u, v4.v,
                                  v3.x, v3.y, v3.z, normal2.x, normal2.y, normal2.z, v3.u, v3.v);
            }
        }

        vertices = flat_vertices;
        for (let i = 0; i < vertices.length / 8; i++) {
            indices.push(i);
        }
    }

    return { vertices, indices };
}

function create_disk(center_position, radius, segments) {
    const vertices = [];
    const indices = [];

    const cx = center_position[0];
    const cy = center_position[1];
    const cz = center_position[2];

    vertices.push(cx, cy, cz, 0.5, 0.5, 0);

    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = cx + radius * Math.cos(angle);
        const y = cy;
        const z = cz + radius * Math.sin(angle);

        const u = 0.5 + 0.5 * Math.cos(angle);
        const v = 0.5 + 0.5 * Math.sin(angle);

        vertices.push(x, y, z, u, v, 0);
    }

    vertices.push(cx, cy, cz, 0.5, 0.5, 0);

    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = cx + radius * Math.cos(angle);
        const y = cy;
        const z = cz + radius * Math.sin(angle);

        const u = 0.5 + 0.5 * Math.cos(angle);
        const v = 0.5 + 0.5 * Math.sin(angle);

        vertices.push(x, y, z, u, v, 0);
    }

    for (let i = 1; i <= segments; i++) {
        indices.push(0, i, i + 1);
    }
    indices[indices.length - 1] = 1;

    const backCenterIndex = segments + 2;
    for (let i = 1; i <= segments; i++) {
        const ringIndex = backCenterIndex + i;
        const nextRingIndex = (i === segments) ? backCenterIndex + 1 : ringIndex + 1;
        indices.push(backCenterIndex, nextRingIndex, ringIndex);
    }

    return {
        vertices: vertices,
        indices: indices,
    };
}

function calculate_normal(x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    let ux = x2 - x1;
    let uy = y2 - y1;
    let uz = z2 - z1;

    let vx = x3 - x1;
    let vy = y3 - y1;
    let vz = z3 - z1;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;

    let length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) {
        nx /= length;
        ny /= length;
        nz /= length;
    }

    return { x: nx, y: ny, z: nz };
}

function create_triangle(start_position, size) {
    let [x, y, z] = start_position;
    let [width, height] = size;

    let vertices = [
        x, y, z, 0, 0, 0,
        x + width, y, z, 0, 1, 0,
        x + width / 2, y + height, z, 0, 1, 1,
    ];

    let indices = [
        0, 1, 2
    ];

    return { vertices: vertices, indices: indices };
}

function create_rect(start_position, size) {
    let [x, y, z] = start_position;
    let [width, height] = size;

    let vertices = [
        x, y, z, 0, 0, 0,
        x + width, y, z, 0, 1, 0,
        x + width, y + height, z, 0, 1, 1,
        x, y + height, z, 0, 0, 1,
    ];

    let indices = [
        0, 1, 2,
        0, 2, 3
    ];

    return { vertices: vertices, indices: indices };
}

function create_xz_plane(size){
    let half = size * 0.5;
    let vertices = [
        -half, 0, -half, 0, 1, 0,
         half, 0, -half, 0, 1, 0,
         half, 0,  half, 0, 1, 0,
        -half, 0,  half, 0, 1, 0
    ];

    let indices = [
        0, 1, 2,
        0, 2, 3
    ];

    return { vertices, indices };
}

function create_circle(center_position, radius, segments){
    let [cx, cy, cz] = center_position;
    let vertices = [
        cx, cy, cz, 0.5, 0.5, 0
    ];
    for (let i = 0; i <= segments; i++) {
        let angle = (i / segments) * Math.PI * 2;
        let x = cx + radius * Math.cos(angle);
        let y = cy + radius * Math.sin(angle);
        let u = 0.5 + 0.5 * Math.cos(angle);
        let v = 0.5 + 0.5 * Math.sin(angle);
        vertices.push(x, y, cz, u, v, 0);
    }
    let indices = [];
    for (let i = 1; i <= segments; i++) {
        indices.push(0, i, i + 1);
    }
    indices[indices.length - 1] = 1;
    return { vertices: vertices, indices: indices };
}

function create_circle_stroke(center_position, radius, segments, stroke_width){
    let [cx, cy, cz] = center_position;
    let points = [];

    for (let i = 0; i <= segments; i++) {
        let angle = (i / segments) * Math.PI * 2;
        let x = cx + radius * Math.cos(angle);
        let y = cy + radius * Math.sin(angle);
        points.push([x, y]);
    }

    points.push(points[0]);
    return create_line(points, stroke_width);
}

function create_coil_3d(turns, height, radius, tube_radius, segments, radial_segments) {
    let points = [];
    let coil_steps = turns * segments;
    for (let i = 0; i <= coil_steps; i++) {
        let t = (i / coil_steps) * Math.PI * 2 * turns;
        let x = Math.cos(t) * radius;
        let y = (i / coil_steps) * height;
        let z = Math.sin(t) * radius;
        points.push([x, y, z]);
    }
    return create_line_3d(points, tube_radius, radial_segments);
}

function create_box(width, height, depth) {
    let vertices = [
        -width / 2, -height / 2, -depth / 2, 0, 0, -1,
        width / 2, -height / 2, -depth / 2, 0, 0, -1,
        width / 2, height / 2, -depth / 2, 0, 0, -1,
        -width / 2, height / 2, -depth / 2, 0, 0, -1,
        -width / 2, -height / 2, depth / 2, 0, 0, 1,
        width / 2, -height / 2, depth / 2, 0, 0, 1,
        width / 2, height / 2, depth / 2, 0, 0, 1,
        -width / 2, height / 2, depth / 2, 0, 0, 1,
        width / 2, -height / 2, -depth / 2, 1, 0, 0,
        width / 2, -height / 2, depth / 2, 1, 0, 0,
        width / 2, height / 2, depth / 2, 1, 0, 0,
        width / 2, height / 2, -depth / 2, 1, 0, 0,
        -width / 2, -height / 2, -depth / 2, -1, 0, 0,
        -width / 2, -height / 2, depth / 2, -1, 0, 0,
        -width / 2, height / 2, depth / 2, -1, 0, 0,
        -width / 2, height / 2, -depth / 2, -1, 0, 0,
        -width / 2, height / 2, -depth / 2, 0, 1, 0,
        width / 2, height / 2, -depth / 2, 0, 1, 0,
        width / 2, height / 2, depth / 2, 0, 1, 0,
        -width / 2, height / 2, depth / 2, 0, 1, 0,
        -width / 2, -height / 2, -depth / 2, 0, -1, 0,
        width / 2, -height / 2, -depth / 2, 0, -1, 0,
        width / 2, -height / 2, depth / 2, 0, -1, 0,
        -width / 2, -height / 2, depth / 2, 0, -1, 0
    ];

    let indices = [
        0,  2,  1,
        0,  3,  2,
        4,  5,  6,
        4,  6,  7,
        8, 10,  9,
        8, 11, 10,
        12, 13, 14,
        12, 14, 15,
        16, 18, 17,
        16, 19, 18,
        20, 21, 22,
        20, 22, 23
    ];

    return { vertices, indices };
}

function create_arrow(from, to, size) {
    let [x1, y1, z1] = from;
    let [x2, y2, z2] = to;
    let [body_width, head_size_width, head_size_height] = size;
    let dx = x2 - x1;
    let dy = y2 - y1;
    let length = Math.sqrt(dx * dx + dy * dy);
    let dir_x = dx / length;
    let dir_y = dy / length;
    let perp_x = -dir_y;
    let perp_y = dir_x;
    let body_half_width = body_width / 2;
    let body_end_x = x2 - dir_x * head_size_height;
    let body_end_y = y2 - dir_y * head_size_height;
    let vertices = [
        x1 + perp_x * body_half_width, y1 + perp_y * body_half_width, z1, 0, 0, 0,
        x1 - perp_x * body_half_width, y1 - perp_y * body_half_width, z1, 0, 1, 0,
        body_end_x - perp_x * body_half_width, body_end_y - perp_y * body_half_width, z1, 0, 1, 1,
        body_end_x + perp_x * body_half_width, body_end_y + perp_y * body_half_width, z1, 0, 0, 1,
        x2, y2, z1, 0.5, 0.5, 0,
        body_end_x + perp_x * head_size_width, body_end_y + perp_y * head_size_width, z1, 0, 0, 0,
        body_end_x - perp_x * head_size_width, body_end_y - perp_y * head_size_width, z1, 0, 1, 0,
    ];
    let indices = [
        0, 1, 2,
        0, 2, 3,
        4, 5, 6,
    ];
    return { vertices: vertices, indices: indices };
}


function create_minus_sign(center_position, size, thickness){
    let [cx, cy, cz] = center_position;
    let half_size = size / 2;
    let half_thickness = thickness / 2;

    let vertices = [
        cx - half_size, cy - half_thickness, cz, 0, 0, 0,
        cx + half_size, cy - half_thickness, cz, 1, 0, 0,
        cx + half_size, cy + half_thickness, cz, 1, 1, 0,
        cx - half_size, cy + half_thickness, cz, 0, 1, 0,
    ];

    let indices = [
        0, 1, 2,
        0, 2, 3,
    ];

    return { vertices: vertices, indices: indices };
}


function create_plus_sign(center_position, size, thickness){
    let [cx, cy, cz] = center_position;
    let half_size = size / 2;
    let half_thickness = thickness / 2;

    let vertices = [
        cx - half_size, cy - half_thickness, cz, 0, 0, 0,
        cx + half_size, cy - half_thickness, cz, 1, 0, 0,
        cx + half_size, cy + half_thickness, cz, 1, 1, 0,
        cx - half_size, cy + half_thickness, cz, 0, 1, 0,
        cx - half_thickness, cy - half_size, cz, 0, 0, 0,
        cx + half_thickness, cy - half_size, cz, 1, 0, 0,
        cx + half_thickness, cy + half_size, cz, 1, 1, 0,
        cx - half_thickness, cy + half_size, cz, 0, 1, 0,
    ];

    let indices = [
        0, 1, 2,
        0, 2, 3,
        4, 5, 6,
        4, 6, 7
    ];

    return { vertices: vertices, indices: indices };
}

function world_to_screen_space(scene, camera, point){
    point = [...point, 1];
    let view_space = mat4_vec4_mul(mat4_transpose(camera.view_matrix), point);
    let clip_space = mat4_vec4_mul(mat4_transpose(camera.projection_matrix), view_space);

    let ndc = [
        clip_space[0] / clip_space[3],
        clip_space[1] / clip_space[3],
        clip_space[2] / clip_space[3],
        1
    ];
    const screen_x = (ndc[0] + 1) * 0.5 * scene.width;
    const screen_y = (1 - ndc[1]) * 0.5 * scene.height;
    return [screen_x, screen_y];
}

function screen_to_world_space(scene, screen_pos, z_distance, camera) {
    const ndc_x = (screen_pos[0] / scene.width) * 2 - 1;
    const ndc_y = (1 - (screen_pos[1] / scene.height)) * 2 - 1;
    const ndc = [ndc_x, ndc_y, 1, 1];

    const clip_space = [
        ndc[0] * z_distance,
        ndc[1] * z_distance,
        ndc[2] * z_distance,
        z_distance
    ];

    let camera_ = camera;
    if(camera_ === undefined){
        camera_ = scene.camera;
    }

    const inv_projection_matrix = mat4_transpose(mat4_invert(camera_.projection_matrix));
    let view_space = mat4_vec4_mul(inv_projection_matrix, clip_space);

    const inv_view_matrix = mat4_transpose(mat4_invert(camera_.view_matrix));
    let world_space = mat4_vec4_mul(inv_view_matrix, view_space);
    return vec3_add(world_space, camera_.position);
}

ctx.canvas = document.getElementById("main-canvas");
ctx.gl = ctx.canvas.getContext("webgl2", {stencil: true});
ctx.gl.getExtension("OES_texture_float");
ctx.gl.getExtension("EXT_color_buffer_half_float");
ctx.font_texture = ctx.gl.createTexture();
ctx.font = {chars:{}, data: {}};
ctx.text_buffers = {};

function create_framebuffer(gl, width, height) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        width, height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, texture, 0
    );

    const renderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorage(
        gl.RENDERBUFFER, gl.DEPTH_COMPONENT16,
        width, height
    );
    gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER, renderbuffer
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [framebuffer, texture, renderbuffer];
}

const [postprocess_framebuffer, postprocess_texture, postprocess_renderbuffer] =
    create_framebuffer(ctx.gl, ctx.gl.canvas.width, ctx.gl.canvas.height);

function create_text_buffer(ctx, text, start_x = 0, start_y = 0, centered = false) {
    let vertices = [];
    let indices = [];
    let offset_x = 0;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let i = 0; i < text.length; i++) {
        const char = ctx.font.chars[text[i]];
        if (!char) continue;

        const x = offset_x + char.xoffset;
        const y = ctx.font.data.base - char.yoffset - char.height;
        const w = char.width;
        const h = char.height;
        const u1 = char.x / ctx.font.data.scale_w;
        const v1 = (char.y + char.height) / ctx.font.data.scale_h;
        const u2 = (char.x + char.width) / ctx.font.data.scale_w;
        const v2 = char.y / ctx.font.data.scale_h;
        const index_offset = vertices.length / 4;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);

        vertices.push(
            x, y, u1, v1,
            x + w, y, u2, v1,
            x + w, y + h, u2, v2,
            x, y + h, u1, v2
        );

        indices.push(
            index_offset, index_offset + 1, index_offset + 2,
            index_offset, index_offset + 2, index_offset + 3
        );

        offset_x += char.xadvance;
    }

    if (vertices.length > 0) {
        if (centered) {
            const bbox_width = maxX - minX;
            const bbox_height = maxY - minY;
            const dx = start_x - (minX + bbox_width / 2);
            const dy = start_y - (minY + bbox_height / 2);

            for (let i = 0; i < vertices.length; i += 4) {
                vertices[i] += dx;
                vertices[i + 1] += dy;
            }
        } else {
            for (let i = 0; i < vertices.length; i += 4) {
                vertices[i] += start_x;
                vertices[i + 1] += start_y;
            }
        }
    }

    return {
        vertices,
        indices,
        bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    };
}

ctx.shaders = {};
ctx.shaders["shader_text"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec2 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec2 position;
out vec2 texcoord;

void main(){
    gl_Position = p*v*m*vec4(vec3(position_attrib, 0.0), 1);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;

uniform sampler2D font_texture;

out vec4 frag_color;

in vec2 position;
in vec2 texcoord;

void main(){
    vec4 font = texture(font_texture, texcoord);
    frag_color = vec4(color * font.a, font.a);
}`);
ctx.shaders["shader_postprocess"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;

out vec4 frag_color;

uniform sampler2D framebuffer_texture;
uniform vec4 scissor_texcoords;
uniform float brightness;
uniform float lod;

in vec3 position;
in vec2 texcoord;

void main(){
    vec2 texcoord_adjusted = mix(scissor_texcoords.xy, scissor_texcoords.zw, texcoord);
    vec4 sample_texture = texture(framebuffer_texture, texcoord_adjusted);
    vec4 color_total = vec4(0.0);
    float weight_total = 0.0;
    float blur_radius = 2.0;
    float blur_sigma = 4.0;
    for (float x = -blur_radius; x <= blur_radius; x++) {
        for (float y = -blur_radius; y <= blur_radius; y++) {
            float weight = exp(-(x * x + y * y) / (2.0 * blur_sigma * blur_sigma));
            vec2 pixel_offset = vec2(x, y) / vec2(textureSize(framebuffer_texture, 3));
            vec4 lod_sample_texture = textureLod(framebuffer_texture, texcoord_adjusted + pixel_offset, lod);
            color_total += lod_sample_texture * weight;
            weight_total += weight;
        }
    }
    color_total /= weight_total;
    frag_color = vec4(color_total.rgb, min(color_total.a, brightness));
}`);
ctx.shaders["shader_basic"] = ctx.create_shader(`#version 300 es
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
    frag_color = vec4(color, 1);
}`);
ctx.shaders["shader_skybox"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;
layout(location = 3) in vec3 tangent_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;

void main(){
    vec4 pos = p*mat4(mat3(v))*vec4(position_attrib, 1);
    gl_Position = pos.xyww;
    position = position_attrib;
}`,
`#version 300 es
precision highp float;

uniform sampler2D envmap_sky;
uniform int underwater_mode;
uniform vec3 camera_pos_world;
uniform float time;
uniform float water_density;
uniform float water_ior;

out vec4 frag_color;

in vec3 position;

const float PI = 3.14159265359;

vec3 sample_lat_long(sampler2D tex, vec3 dir) {
    float u = atan(dir.z, dir.x) / (2.0 * 3.14159265359) + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5;

    vec2 uv = vec2(u, v);

    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);

    if (dx.x > 0.5)  dx.x -= 1.0;
    if (dx.x < -0.5) dx.x += 1.0;
    if (dy.x > 0.5)  dy.x -= 1.0;
    if (dy.x < -0.5) dy.x += 1.0;

    return textureGrad(tex, uv, dx, dy).rgb;
}

vec3 sample_env(vec3 ray_dir){
    return sample_lat_long(envmap_sky, normalize(ray_dir)).rgb;
}

vec3 sample_lat_long_sharp(sampler2D tex, vec3 dir) {
    float u = atan(dir.z, dir.x) / (2.0 * 3.14159265359) + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5;

    vec2 uv = vec2(u, v);

    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);

    if (dx.x > 0.5)  dx.x -= 1.0;
    if (dx.x < -0.5) dx.x += 1.0;
    if (dy.x > 0.5)  dy.x -= 1.0;
    if (dy.x < -0.5) dy.x += 1.0;

    float sharpness = 0.1;
    return textureGrad(tex, uv, dx * sharpness, dy * sharpness).rgb;
}

vec3 sample_env_sharp(vec3 ray_dir){
    return sample_lat_long_sharp(envmap_sky, normalize(ray_dir)).rgb;
}

vec3 orient_interface_normal(vec3 n, vec3 incident_dir){
    return dot(incident_dir, n) <= 0.0 ? n : -n;
}

float fresnel_dielectric(float n1, float n2, float cos_i, float cos_t){
    float rs_num = n1 * cos_i - n2 * cos_t;
    float rs_den = n1 * cos_i + n2 * cos_t;
    float rp_num = n1 * cos_t - n2 * cos_i;
    float rp_den = n1 * cos_t + n2 * cos_i;

    float rs = 0.0;
    float rp = 0.0;
    if(abs(rs_den) > 1e-6){
        rs = rs_num / rs_den;
    }
    if(abs(rp_den) > 1e-6){
        rp = rp_num / rp_den;
    }
    return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}

float hash12(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float value_noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 value_noise_grad(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float nx0 = mix(a, b, u.x);
    float nx1 = mix(c, d, u.x);
    float dv_dx = mix(b - a, d - c, u.y) * du.x;
    float dv_dy = (nx1 - nx0) * du.y;
    return vec2(dv_dx, dv_dy);
}

float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for(int i = 0; i < 4; i++){
        v += a * value_noise(p);
        p = m * p + vec2(19.1, 7.7);
        a *= 0.5;
    }
    return v;
}

vec2 fbm_grad(vec2 p0){
    float a = 0.5;
    vec2 grad = vec2(0.0);
    vec2 p = p0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    mat2 jacobian = mat2(1.0);
    for(int i = 0; i < 4; i++){
        vec2 ng = value_noise_grad(p);
        grad += a * (transpose(jacobian) * ng);
        p = m * p + vec2(19.1, 7.7);
        jacobian = m * jacobian;
        a *= 0.5;
    }
    return grad;
}

vec2 wave_height_grad(vec2 xz){
    vec2 p = xz * 0.22;
    vec2 flow = vec2(0.05, -0.04) * time;

    float w1 = fbm(p * 0.35 + flow);
    float w2 = fbm(p * 0.35 - flow * 1.3);
    p += (vec2(w1, w2) - 0.5) * 1.6;

    vec2 grad_p = fbm_grad(p + flow * 1.8);
    grad_p += (0.42 * 2.4) * fbm_grad(p * 2.4 - flow * 2.1);
    return grad_p * 0.22;
}

vec3 deform_normal(vec3 base_normal, vec3 world_pos){
    vec2 grad = wave_height_grad(world_pos.xz);

    float wave_strength = 0.42;
    vec3 n = normalize(vec3(-grad.x * wave_strength, 1.0, -grad.y * wave_strength));
    if(base_normal.y < 0.0){
        n = -n;
    }
    if(dot(n, base_normal) < 0.0){
        n = -n;
    }
    return n;
}

vec3 medium_radiance(
    vec3 dir,
    vec3 sigma_t,
    vec3 albedo,
    vec3 deep_color,
    vec3 sky_ambient
){
    float dir_down = max(-dir.y, 0.02);
    float depth = 9.0 / dir_down;
    vec3 trans = exp(-sigma_t * depth);
    vec3 refracted_bg = sample_env(dir);

    float air_visibility = smoothstep(0.0, 0.12, dir.y);
    refracted_bg *= air_visibility;
    vec3 inscatter_light = mix(deep_color, sky_ambient * albedo, 0.75);
    vec3 inscatter = (vec3(1.0) - trans) * inscatter_light;
    vec3 medium_col = refracted_bg * trans + inscatter;

    float deep_weight = 1.0 - exp(-depth / 10.0);
    return mix(medium_col, deep_color, clamp(deep_weight, 0.0, 1.0));
}

void main(){
    vec3 ray_dir = normalize(-position);
    vec3 color = sample_env(ray_dir);

    if(underwater_mode == 1){
        vec3 water_ray_dir = -ray_dir;
        float density = max(water_density, 0.0);
        vec3 sigma_a = vec3(0.22, 0.07, 0.025) * density;
        vec3 sigma_s = vec3(0.02, 0.045, 0.065) * density;
        vec3 sigma_t = sigma_a + sigma_s;
        vec3 albedo = sigma_s / max(sigma_t, vec3(1e-6));
        vec3 sky_ambient = sample_env(vec3(0.0, 1.0, 0.0));
        vec3 deep_color = vec3(0.005, 0.03, 0.06);
        float n1 = max(water_ior, 1e-4);

        if(abs(n1 - 1.0) < 1e-4){
            if(density < 1e-6){
                color = sample_env_sharp(water_ray_dir);
            }
            else{
                color = medium_radiance(water_ray_dir, sigma_t, albedo, deep_color, sky_ambient);
            }
        }
        else if(water_ray_dir.y <= 1e-5){
            color = medium_radiance(water_ray_dir, sigma_t, albedo, deep_color, sky_ambient);
        }
        else{
            float t_surface = max((-camera_pos_world.y) / water_ray_dir.y, 0.0);
            vec3 att = exp(-sigma_t * t_surface);
            float up_clarity = smoothstep(0.0, 0.4, water_ray_dir.y);
            vec3 scatter = (vec3(1.0) - att) * albedo * sky_ambient * (1.0 - up_clarity);

            vec3 hit_point = camera_pos_world + water_ray_dir * t_surface;

            vec3 interface_normal = vec3(0.0, -1.0, 0.0);
            interface_normal = deform_normal(vec3(0.0, -1.0, 0.0), hit_point);
            interface_normal = orient_interface_normal(interface_normal, water_ray_dir);

            float n2 = 1.0;
            float eta = n1 / n2;
            float cos_i = clamp(-dot(water_ray_dir, interface_normal), 0.0, 1.0);
            float sin2_t = eta * eta * max(0.0, 1.0 - cos_i * cos_i);
            bool tir = sin2_t > 1.0;

            float fresnel = 1.0;
            vec3 refract_air = vec3(0.0);
            if(!tir){
                float cos_t = sqrt(max(0.0, 1.0 - sin2_t));
                fresnel = fresnel_dielectric(n1, n2, cos_i, cos_t);
                refract_air = normalize(eta * water_ray_dir + (eta * cos_i - cos_t) * interface_normal);
            }

            vec3 reflected_inside = medium_radiance(reflect(water_ray_dir, interface_normal), sigma_t, albedo, deep_color, sky_ambient);
            vec3 transmitted_air = tir ? vec3(0.0) : sample_env_sharp(refract_air);

            vec3 interface_radiance = fresnel * reflected_inside + (1.0 - fresnel) * transmitted_air;
            color = scatter + att * interface_radiance;
        }
    }

    color = pow(max(color, vec3(0.0)), vec3(1.0/2.2));
    frag_color = vec4(color, 1);
}`);
ctx.shaders["shader_water"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;
out vec3 camera_pos;

void main(){
    vec4 world_pos = m*vec4(position_attrib, 1.0);
    gl_Position = p*v*world_pos;
    position = world_pos.xyz;
    mat3 normal_matrix = transpose(inverse(mat3(m)));
    normal = normalize(normal_matrix*normal_attrib);
    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

uniform sampler2D envmap_sky;
uniform float time;
uniform float water_density;
uniform float water_ior;

out vec4 frag_color;

in vec3 position;
in vec3 normal;
in vec3 camera_pos;

const float PI = 3.14159265359;

vec3 sample_lat_long(sampler2D tex, vec3 dir) {
    float u = atan(dir.z, dir.x) / (2.0 * 3.14159265359) + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5;

    vec2 uv = vec2(u, v);

    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);

    if (dx.x > 0.5)  dx.x -= 1.0;
    if (dx.x < -0.5) dx.x += 1.0;
    if (dy.x > 0.5)  dy.x -= 1.0;
    if (dy.x < -0.5) dy.x += 1.0;

    return textureGrad(tex, uv, dx, dy).rgb;
}

vec3 sample_env(vec3 ray_dir){
    return sample_lat_long(envmap_sky, normalize(-ray_dir)).rgb;
}

vec3 orient_interface_normal(vec3 n, vec3 incident_dir){
    return dot(incident_dir, n) <= 0.0 ? n : -n;
}

float fresnel_dielectric(float n1, float n2, float cos_i, float cos_t){
    float rs_num = n1 * cos_i - n2 * cos_t;
    float rs_den = n1 * cos_i + n2 * cos_t;
    float rp_num = n1 * cos_t - n2 * cos_i;
    float rp_den = n1 * cos_t + n2 * cos_i;

    float rs = 0.0;
    float rp = 0.0;
    if(abs(rs_den) > 1e-6){
        rs = rs_num / rs_den;
    }
    if(abs(rp_den) > 1e-6){
        rp = rp_num / rp_den;
    }
    return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}

float hash12(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float value_noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 value_noise_grad(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float nx0 = mix(a, b, u.x);
    float nx1 = mix(c, d, u.x);
    float dv_dx = mix(b - a, d - c, u.y) * du.x;
    float dv_dy = (nx1 - nx0) * du.y;
    return vec2(dv_dx, dv_dy);
}

float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for(int i = 0; i < 4; i++){
        v += a * value_noise(p);
        p = m * p + vec2(19.1, 7.7);
        a *= 0.5;
    }
    return v;
}

vec2 fbm_grad(vec2 p0){
    float a = 0.5;
    vec2 grad = vec2(0.0);
    vec2 p = p0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    mat2 jacobian = mat2(1.0);
    for(int i = 0; i < 4; i++){
        vec2 ng = value_noise_grad(p);
        grad += a * (transpose(jacobian) * ng);
        p = m * p + vec2(19.1, 7.7);
        jacobian = m * jacobian;
        a *= 0.5;
    }
    return grad;
}

vec2 wave_height_grad(vec2 xz){
    vec2 p = xz * 0.22;
    vec2 flow = vec2(0.05, -0.04) * time;

    float w1 = fbm(p * 0.35 + flow);
    float w2 = fbm(p * 0.35 - flow * 1.3);
    p += (vec2(w1, w2) - 0.5) * 1.6;

    vec2 grad_p = fbm_grad(p + flow * 1.8);
    grad_p += (0.42 * 2.4) * fbm_grad(p * 2.4 - flow * 2.1);
    return grad_p * 0.22;
}

vec3 deform_normal(vec3 base_normal, vec3 world_pos){
    vec2 grad = wave_height_grad(world_pos.xz);

    float wave_strength = 0.42;
    vec3 n = normalize(vec3(-grad.x * wave_strength, 1.0, -grad.y * wave_strength));
    if(base_normal.y < 0.0){
        n = -n;
    }
    if(dot(n, base_normal) < 0.0){
        n = -n;
    }
    return n;
}

vec3 medium_radiance(
    vec3 dir,
    vec3 sigma_t,
    vec3 albedo,
    vec3 deep_color,
    vec3 sky_ambient
){
    float dir_down = max(-dir.y, 0.02);
    float depth = 9.0 / dir_down;
    vec3 trans = exp(-sigma_t * depth);
    vec3 refracted_bg = sample_env(dir);
    float air_visibility = smoothstep(0.0, 0.12, dir.y);
    refracted_bg *= air_visibility;
    vec3 inscatter_light = mix(deep_color, sky_ambient * albedo, 0.75);
    vec3 inscatter = (vec3(1.0) - trans) * inscatter_light;
    vec3 medium_col = refracted_bg * trans + inscatter;

    float deep_weight = 1.0 - exp(-depth / 10.0);
    return mix(medium_col, deep_color, clamp(deep_weight, 0.0, 1.0));
}

void main(){
    vec3 incident_dir = normalize(position - camera_pos);

    float n_air = 1.0;
    float n_water = max(water_ior, 1e-4);
    bool camera_outside = camera_pos.y >= 0.0;
    float n1 = camera_outside ? n_air : n_water;
    float n2 = camera_outside ? n_water : n_air;

    vec3 interface_normal = camera_outside ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
    interface_normal = deform_normal(interface_normal, position);
    interface_normal = orient_interface_normal(interface_normal, incident_dir);

    float density = max(water_density, 0.0);
    vec3 sigma_a = vec3(0.22, 0.07, 0.025) * density;
    vec3 sigma_s = vec3(0.02, 0.045, 0.065) * density;
    vec3 sigma_t = sigma_a + sigma_s;
    vec3 albedo = sigma_s / max(sigma_t, vec3(1e-6));
    vec3 sky_ambient = sample_env(vec3(0.0, 1.0, 0.0));
    vec3 deep_color = vec3(0.005, 0.03, 0.06);

    bool almost_same_ior = abs(n1 - n2) < 1e-5;
    if(almost_same_ior){
        discard;
    }

    float eta12 = n1 / n2;
    float cos_i = clamp(-dot(incident_dir, interface_normal), 0.0, 1.0);
    float sin2_t = eta12 * eta12 * max(0.0, 1.0 - cos_i * cos_i);
    bool first_tir = sin2_t > 1.0;
    vec3 first_refract_dir = vec3(0.0);
    float fresnel = 1.0;
    if(!first_tir){
        float cos_t = sqrt(max(0.0, 1.0 - sin2_t));
        first_refract_dir = normalize(eta12 * incident_dir + (eta12 * cos_i - cos_t) * interface_normal);
        fresnel = fresnel_dielectric(n1, n2, cos_i, cos_t);
    }
    vec3 reflect_dir = reflect(incident_dir, interface_normal);
    vec3 result = vec3(0.0);

    if(camera_outside){
        vec3 reflection = sample_env(reflect_dir);
        vec3 transmission = vec3(0.0);
        if(!first_tir){
            transmission = medium_radiance(first_refract_dir, sigma_t, albedo, deep_color, sky_ambient);
        }
        result = mix(transmission, reflection, fresnel);
    }
    else{
        float t_cam = max(length(position - camera_pos), 0.0);
        vec3 att_cam = exp(-sigma_t * t_cam);
        vec3 scatter_cam = (vec3(1.0) - att_cam) * albedo * sky_ambient;

        vec3 reflected_inside = medium_radiance(reflect_dir, sigma_t, albedo, deep_color, sky_ambient);
        vec3 transmitted_air = vec3(0.0);
        if(!first_tir){
            transmitted_air = sample_env(first_refract_dir);
        }

        vec3 interface_radiance = fresnel * reflected_inside + (1.0 - fresnel) * transmitted_air;
        result = scatter_cam + att_cam * interface_radiance;
    }

    frag_color = vec4(pow(max(result, vec3(0.0)), vec3(1.0/2.2)), 1.0);
}`);
ctx.shaders["shader_basic_alpha"] = ctx.create_shader(`#version 300 es
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
uniform float alpha;

out vec4 frag_color;

in vec3 position;
in vec3 normal;

void main(){
    frag_color = vec4(color, alpha);
}`);
ctx.shaders["shader_spd"] = ctx.create_shader(`#version 300 es
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
uniform int small_graph;
uniform int grayed;

out vec4 frag_color;

in vec3 position;
in vec3 normal;

vec3 wavelength_to_rgb(float wavelength) {
    float r = 0.0, g = 0.0, b = 0.0;

    if (wavelength >= 380.0 && wavelength < 450.0) {
        r = 0.5 * (450.0 - wavelength) / (450.0 - 380.0);
        g = 0.0;
        b = 1.0;
    }
    else if (wavelength >= 450.0 && wavelength < 540.0) {
        r = 0.0;
        g = (wavelength - 450.0) / (540.0 - 450.0);
        b = 1.0 - (wavelength - 450.0) / (540.0 - 450.0);
    }
    else if (wavelength >= 540.0 && wavelength < 590.0) {
        r = (wavelength - 540.0) / (590.0 - 540.0);
        g = 1.0;
        b = 0.0;
    }
    else if (wavelength >= 590.0 && wavelength <= 700.0) {
        r = 1.0;
        g = 1.0 - (wavelength - 590.0) / (700.0 - 590.0);
        b = 0.0;
    }

    float fade = smoothstep(370.0, 420.0, wavelength) * smoothstep(700.0, 650.0, wavelength);
    return vec3(r, g, b) * fade;
}


vec3 wavelength_to_rgb_small(float wavelength) {
    float r = 0.0, g = 0.0, b = 0.0;

    if (wavelength >= 380.0 && wavelength < 450.0) {
        r = 0.5 * (450.0 - wavelength) / (450.0 - 380.0);
        g = 0.0;
        b = 1.0;
    }
    else if (wavelength >= 450.0 && wavelength < 540.0) {
        r = 0.0;
        g = (wavelength - 450.0) / (540.0 - 450.0);
        b = 1.0 - (wavelength - 450.0) / (540.0 - 450.0);
    }
    else if (wavelength >= 540.0 && wavelength < 590.0) {
        r = (wavelength - 540.0) / (590.0 - 540.0);
        g = 1.0;
        b = 0.0;
    }
    else if (wavelength >= 590.0 ) {
        r = 1.0;
        g = 1.0 - (wavelength - 590.0) / (700.0 - 590.0);
        b = 0.0;
    }

    return vec3(r, g, b);
}

void main(){
    if(small_graph == 1){
        float grayed_scale = 0.0;
        if(grayed == 1){
            grayed_scale = 0.85;
        }
        frag_color = vec4(wavelength_to_rgb_small(mix(420.0, 760.0, position.x*1.7)) * 1.2 - vec3(grayed_scale), 1);
    }
    else{
        frag_color = vec4(wavelength_to_rgb(mix(350.0, 720.0, position.x/2.0)), 1);
    }
}`);
ctx.shaders["shader_spectrum"] = ctx.create_shader(`#version 300 es
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

out vec4 frag_color;

in vec3 position;
in vec3 normal;

vec3 wavelength_to_rgb(float wavelength) {
    float r = 0.0, g = 0.0, b = 0.0;

    if (wavelength >= 380.0 && wavelength < 450.0) {
        r = 0.5 * (450.0 - wavelength) / (450.0 - 380.0);
        g = 0.0;
        b = 1.0;
    }
    else if (wavelength >= 450.0 && wavelength < 540.0) {
        r = 0.0;
        g = (wavelength - 450.0) / (540.0 - 450.0);
        b = 1.0 - (wavelength - 450.0) / (540.0 - 450.0);
    }
    else if (wavelength >= 540.0 && wavelength < 590.0) {
        r = (wavelength - 540.0) / (590.0 - 540.0);
        g = 1.0;
        b = 0.0;
    }
    else if (wavelength >= 590.0 && wavelength <= 700.0) {
        r = 1.0;
        g = 1.0 - (wavelength - 590.0) / (700.0 - 590.0);
        b = 0.0;
    }

    float fade = smoothstep(370.0, 420.0, wavelength) * smoothstep(700.0, 650.0, wavelength);
    return vec3(r, g, b) * fade;
}

void main(){
    frag_color = vec4(wavelength_to_rgb(mix(450.0, 620.0, normal.y*2.0-0.5)), 1);
}`);
ctx.shaders["shader_field"] = ctx.create_shader(`#version 300 es
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

out vec4 frag_color;

in vec3 position;
in vec3 normal;

void main(){
    vec3 blue = vec3(0.922, 0.204, 0.204);
    vec3 red = vec3(0.204, 0.443, 0.922);
    frag_color = vec4(mix(blue, red, position.x), 1);
}`);
ctx.shaders["shader_shaded"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = position_attrib;
    normal = normal_attrib;
    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;
uniform int metallic;

out vec4 frag_color;

in vec3 position;
in vec3 normal;
in vec3 camera_pos;

void main(){
    if(metallic == 1){
        vec3 light_pos = vec3(0, 2, 1);
        vec3 light_dir = normalize(light_pos - position);
        vec3 view_dir = normalize(camera_pos - position);
        vec3 reflect_dir = reflect(-light_dir, normal);
        float angle = max(dot(normal, light_dir), 0.0);
        float dist = 1.0 / distance(light_pos, position);
        float diff = angle * dist;
        float spec = pow(max(dot(view_dir, reflect_dir), 0.0), 8.0);
        float light = clamp(diff + spec + 0.8, 0.0, 1.0);
        vec3 envmap = normalize(reflect(-view_dir, normal));
        float env_intensity = 0.5 + 0.5 * dot(envmap, vec3(0.0, 0.0, 1.0));
        vec3 env_color = vec3(env_intensity) * 0.35;
        vec3 metal_color = color * diff + env_color * (spec * 3.5);
        frag_color = vec4(metal_color + 0.4, 1.0);
    }
    else{
        vec3 light_pos = vec3(0, 2, 1);
        float angle = clamp(dot(normalize(light_pos), normal), 0.0, 1.0);
        float dist = 1.0/distance(light_pos, position);
        float light = angle*dist+0.7;
        light = clamp(light, 0.0, 1.0);
        frag_color = vec4(color*1.1*light, 1.0);
    }
}`);
ctx.shaders["shader_sun_cross"] = ctx.create_shader(`#version 300 es
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
uniform int metallic;

out vec4 frag_color;

in vec3 position;
in vec3 normal;

void main(){
    float d = distance(position, vec3(0, 0, 0));
    vec3 color = mix(vec3(1.000, 0.796, 0.610), vec3(0.926, 0.244, 0.000), d);
    if(d > 0.8){
        color = mix(vec3(0.9, 0.2, 0), vec3(0.7, 0.1, 0), (d - 0.8) / 0.2);
    }
    frag_color = vec4(color, 1.0);
}`);

ctx.shaders["shader_sun_surface"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;
out vec2 texcoord;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = position_attrib;
    normal = normal_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;
uniform int metallic;
uniform float time;

out vec4 frag_color;

in vec3 position;
in vec3 normal;
in vec2 texcoord;

float noise(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float smooth_noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(mix(noise(i + vec2(0.0, 0.0)),
                   noise(i + vec2(1.0, 0.0)), u.x),
               mix(noise(i + vec2(0.0, 1.0)),
                   noise(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec3 p)
{
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);

    for (int i = 0; i < 6; ++i) {
        v += a * smooth_noise(p.xy + time);
        v += a * smooth_noise(p.xz + time);
        v += a * smooth_noise(p.yz + time);
        p = p * 3.0 + shift;
        a *= 0.5;
    }
    return v / 3.0;
}

void main(){
    vec3 yellow = vec3(1.000, 0.605, 0.0);
    vec3 orange = vec3(1.000, 0.383, 0.0);
    float n = pow(fbm(normalize(position)), 3.0)*3.0;
    vec3 color = mix(yellow, orange, n);
    frag_color = vec4(color, 1.0);
}`);
ctx.shaders["shader_apple"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = position_attrib;
    normal = normal_attrib;
    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

uniform vec3 light_pos;
uniform vec3 color;
uniform int specular_factor;

out vec4 frag_color;

in vec3 position;
in vec3 normal;
in vec3 camera_pos;

void main(){
    vec3 light_dir = normalize(light_pos - position);
    vec3 view_dir = normalize(camera_pos - position);
    vec3 reflect_dir = reflect(-light_dir, normal);
    float specular = pow(max(dot(view_dir, reflect_dir), 0.0), 8.0);
    if(specular_factor == 1){
        specular *= 0.0;
    }
    float angle = clamp(dot(normalize(light_pos), normal), 0.0, 1.0);
    float diffuse = angle;
    frag_color = vec4(color*(diffuse*0.6+ 0.5) + vec3(specular)*0.5*(color.r+color.g+color.b)/3.0, 1.0);
}`);
ctx.shaders["shader_glass"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 normal;
out vec3 world_normal;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    mat3 inv_m = mat3(transpose(inverse(m)));
    world_normal = inv_m * normal_attrib;
    world_position = (m*vec4(position_attrib, 1)).xyz;
    normal = normal_attrib;
    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;
uniform float alpha;

out vec4 frag_color;

in vec3 world_position;
in vec3 normal;
in vec3 world_normal;
in vec3 camera_pos;

void main(){
    vec3 view_dir = normalize(camera_pos - world_position);
    vec3 reflect_dir = reflect(-view_dir, normalize(world_normal));
    float fresnel = pow(1.0 - max(dot(normalize(world_normal), view_dir), 0.0), 2.0);
    vec3 refract_dir = refract(-view_dir, normalize(world_normal), 0.95);

    frag_color = vec4(vec3(max(0.3-fresnel, 0.2))*color, alpha);
}`);
ctx.shaders["shader_flashlight"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 normal;
out vec3 world_normal;
out vec3 camera_pos;

mat4 rotate_3d(vec3 axis, float angle) {
    float s = sin(angle / 2.0);
    vec4 q = vec4(axis[0] * s, axis[1] * s, axis[2] * s, cos(angle / 2.0));
    float xx = q[0] * q[0];
    float yy = q[1] * q[1];
    float zz = q[2] * q[2];
    return mat4(
        1.0 - 2.0 * yy - 2.0 * zz, 2.0 * q[0] * q[1] + 2.0 * q[2] * q[3], 2.0 * q[0] * q[2] - 2.0 * q[1] * q[3], 0.0,
        2.0 * q[0] * q[1] - 2.0 * q[2] * q[3], 1.0 - 2.0 * xx - 2.0 * zz, 2.0 * q[1] * q[2] + 2.0 * q[0] * q[3], 0.0,
        2.0 * q[0] * q[2] + 2.0 * q[1] * q[3], 2.0 * q[1] * q[2] - 2.0 * q[0] * q[3], 1.0 - 2.0 * xx - 2.0 * yy, 0.0,
        0.0, 0.0, 0.0, 1.0
    );
}

float rad(float deg){
    return deg*3.14159265359/180.0;
}

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    mat3 inv_m = mat3(transpose(inverse(m)));
    world_normal = inv_m * normal_attrib;

    mat4 rot = rotate_3d(vec3(0, 1, 0), rad(5.0))*rotate_3d(vec3(0, 0, 1), rad(20.0));
    world_position = (rot*m*vec4(position_attrib, 1)).xyz;
    normal = normal_attrib;
    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;
uniform float alpha;

out vec4 frag_color;

in vec3 world_position;
in vec3 normal;
in vec3 world_normal;

void main(){
    frag_color = vec4(1, 0, 0, 1);
    float alpha_ = 1.0 - (world_position.x/15.0+0.9);
    frag_color = vec4(color, alpha_*alpha);
}`);
ctx.shaders["shader_plane"] = ctx.create_shader(`#version 300 es
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
uniform float time;

out vec4 frag_color;

in vec3 position;
in vec3 normal;
#define NUM_POSITIVE 10
#define NUM_NEGATIVE 10
void main(){
    float aspect_ratio = 1000.0/400.0;
    vec2 uv = normal.yz * vec2(aspect_ratio, 1);
    float time_scaled = time*2.0;
    vec2 positive_charge[NUM_POSITIVE] = vec2[](
        vec2(0.5 + 0.3 * sin(time_scaled + 0.1), 0.5 + 0.3 * cos(time_scaled + 0.1)),
        vec2(-0.4 + 0.2 * sin(time_scaled + 0.2), 0.3 + 0.2 * cos(time_scaled + 0.3)),
        vec2(0.2 + 0.3 * cos(time_scaled + 0.4), -0.2 + 0.3 * sin(time_scaled + 0.5)),
        vec2(0.1 + 0.3 * sin(time_scaled + 0.6), 0.4 + 0.3 * cos(time_scaled + 0.7)),
        vec2(-0.3 + 0.2 * cos(time_scaled + 0.8), 0.1 + 0.2 * sin(time_scaled + 0.9)),
        vec2(0.4 + 0.3 * cos(time_scaled + 1.0), -0.4 + 0.3 * sin(time_scaled + 1.1)),
        vec2(-0.1 + 0.2 * sin(time_scaled + 1.2), -0.3 + 0.2 * cos(time_scaled + 1.3)),
        vec2(0.3 + 0.3 * sin(time_scaled + 1.4), 0.2 + 0.3 * cos(time_scaled + 1.5)),
        vec2(-0.2 + 0.2 * cos(time_scaled + 1.6), -0.1 + 0.2 * sin(time_scaled + 1.7)),
        vec2(0.0 + 0.3 * sin(time_scaled + 1.8), 0.0 + 0.3 * cos(time_scaled + 1.9))
    );

    vec2 negative_charge[NUM_NEGATIVE] = vec2[](
        vec2(-0.5 + 0.3 * sin(time_scaled + 0.2), -0.5 + 0.3 * cos(time_scaled + 0.2)),
        vec2(0.4 + 0.2 * cos(time_scaled + 0.3), -0.3 + 0.2 * sin(time_scaled + 0.4)),
        vec2(-0.2 + 0.3 * sin(time_scaled + 0.5), 0.2 + 0.3 * cos(time_scaled + 0.6)),
        vec2(-0.1 + 0.3 * cos(time_scaled + 0.7), -0.4 + 0.3 * sin(time_scaled + 0.8)),
        vec2(0.3 + 0.2 * sin(time_scaled + 0.9), -0.1 + 0.2 * cos(time_scaled + 1.0)),
        vec2(-0.4 + 0.3 * cos(time_scaled + 1.1), 0.4 + 0.3 * sin(time_scaled + 1.2)),
        vec2(0.1 + 0.2 * sin(time_scaled + 1.3), 0.3 + 0.2 * cos(time_scaled + 1.4)),
        vec2(-0.3 + 0.3 * sin(time_scaled + 1.5), -0.2 + 0.3 * cos(time_scaled + 1.6)),
        vec2(0.2 + 0.2 * cos(time_scaled + 1.7), 0.1 + 0.2 * sin(time_scaled + 1.8)),
        vec2(-0.0 + 0.3 * cos(time_scaled + 1.9), -0.0 + 0.3 * sin(time_scaled + 2.0))
    );

    vec2 origin = (uv - vec2(0.5, 0.5)) * 2.0;

    float charge = 0.0;
    float charge_normalized = 0.0;
    float decay_factor = 2.0;
    float max_distance = 0.0;
    for (int i = 0; i < NUM_POSITIVE; i++) {
        float dist_to_positive = distance(origin, positive_charge[i]+vec2(1.5, 0));
        float positive_decay = exp(-dist_to_positive * decay_factor) * 1.0;
        charge += positive_decay;
        charge_normalized += dist_to_positive;
        if(dist_to_positive > max_distance){
            max_distance = dist_to_positive;
        }
    }

    for (int i = 0; i < NUM_NEGATIVE; i++) {
        float dist_to_negative = distance(origin, negative_charge[i]+vec2(1.5, 0));
        float negative_decay = exp(-dist_to_negative * decay_factor) * 1.0;
        charge -= negative_decay;
        charge_normalized -= dist_to_negative;
        if(dist_to_negative > max_distance){
            max_distance = dist_to_negative;
        }
    }
    charge = clamp(charge, -1.0, 1.0);

    vec3 color = vec3(0.0);

    if (charge > 0.0) {
        color = mix(vec3(0.98, 0.98, 0.98), vec3(0.204, 0.443, 0.922), charge);
    } else {
        color = mix(vec3(0.98, 0.98, 0.98), vec3(0.922, 0.204, 0.204), -charge);
    }

    frag_color = vec4(color, 1);
}`);


ctx.shaders["shader_normal_distribution"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;
layout(location = 3) in vec3 tangent_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 world_normal;
out vec2 texcoord;
out vec3 world_tangent;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    world_position = (m*vec4(position_attrib, 1)).xyz;
    mat3 inv_model = mat3(transpose(inverse(m)));
    world_normal = inv_model*normal_attrib;
    world_tangent = inv_model*tangent_attrib;
    texcoord = texcoord_attrib;

    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

out vec4 frag_color;

uniform float roughness;

in vec3 world_position;
in vec3 world_normal;
in vec2 texcoord;
in vec3 world_tangent;
in vec3 camera_pos;

const float PI = 3.14159265359;

float normal_distribution_ggx(vec3 normal, vec3 halfway_vector, float roughness) {
    float a = roughness * roughness;
    float a_2 = a * a;
    float normal_dot_halfway = max(dot(normal, halfway_vector), 0.0);
    float normal_dot_halfway_2 = normal_dot_halfway * normal_dot_halfway;

    float num = a_2;
    float denom = (normal_dot_halfway_2 * (a_2 - 1.0) + 1.0);

    return a_2 / (PI * denom * denom);
}

void main(){
    vec3 light_dir = normalize(vec3(1, 1, 0));
    vec3 view_vector = normalize(camera_pos - world_position);
    vec3 normal = normalize(world_normal);
    vec3 halfway_vector = normalize(view_vector + light_dir);
    frag_color = vec4(vec3(normal_distribution_ggx(world_normal, halfway_vector, roughness)), 1);
}`);


ctx.shaders["shader_geometric_function"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;
layout(location = 3) in vec3 tangent_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 world_normal;
out vec2 texcoord;
out vec3 world_tangent;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    world_position = (m*vec4(position_attrib, 1)).xyz;
    mat3 inv_model = mat3(transpose(inverse(m)));
    world_normal = inv_model*normal_attrib;
    world_tangent = inv_model*tangent_attrib;
    texcoord = texcoord_attrib;

    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

out vec4 frag_color;

uniform float roughness;

in vec3 world_position;
in vec3 world_normal;
in vec2 texcoord;
in vec3 world_tangent;
in vec3 camera_pos;

const float PI = 3.14159265359;

float geometry_schlick_ggx(float normal_dot_view, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    return normal_dot_view / (normal_dot_view * (1.0 - k) + k);
}

float geometry_smith(vec3 normal, vec3 view, vec3 light, float roughness) {
    float normal_dot_view = max(dot(normal, view), 0.0);
    float normal_dot_light = max(dot(normal, light), 0.0);
    float ggx2 = geometry_schlick_ggx(normal_dot_view, roughness);
    float ggx1 = geometry_schlick_ggx(normal_dot_light, roughness);

    return ggx1 * ggx2;
}

void main(){
    vec3 light_dir = normalize(vec3(1, 1, 0));
    vec3 view_vector = normalize(camera_pos - world_position);
    vec3 normal = normalize(world_normal);
    frag_color = vec4(vec3(geometry_smith(world_normal, view_vector, light_dir, roughness)), 1);
}`);

ctx.shaders["shader_fresnel"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;
layout(location = 3) in vec3 tangent_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 world_normal;
out vec2 texcoord;
out vec3 world_tangent;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    world_position = (m*vec4(position_attrib, 1)).xyz;
    mat3 inv_model = mat3(transpose(inverse(m)));
    world_normal = inv_model*normal_attrib;
    world_tangent = inv_model*tangent_attrib;
    texcoord = texcoord_attrib;

    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

out vec4 frag_color;

uniform vec3 base_reflectance;

in vec3 world_position;
in vec3 world_normal;
in vec2 texcoord;
in vec3 world_tangent;
in vec3 camera_pos;

const float PI = 3.14159265359;

vec3 fresnel_schlick(float view_dot_halfway, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - view_dot_halfway, 0.0, 1.0), 5.0);
}
void main(){
    vec3 light_dir = normalize(vec3(1, 1, 0));
    vec3 view_vector = normalize(camera_pos - world_position);
    vec3 normal = normalize(world_normal);
    frag_color = vec4(fresnel_schlick(dot(view_vector, normal), base_reflectance), 1);
}`);

ctx.shaders["shader_pbr_demo"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;
layout(location = 3) in vec3 tangent_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 world_normal;
out vec2 texcoord;
out vec3 world_tangent;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    world_position = (m*vec4(position_attrib, 1)).xyz;
    mat3 inv_model = mat3(transpose(inverse(m)));
    world_normal = inv_model*normal_attrib;
    world_tangent = inv_model*tangent_attrib;
    texcoord = texcoord_attrib;

    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

out vec4 frag_color;

uniform vec3 albedo;
uniform float metallic;
uniform float roughness;
uniform vec3 light_direction;

in vec3 world_position;
in vec3 world_normal;
in vec2 texcoord;
in vec3 world_tangent;
in vec3 camera_pos;

const float PI = 3.14159265359;


vec3 fresnel_schlick(float view_dot_halfway, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - view_dot_halfway, 0.0, 1.0), 5.0);
}

float normal_distribution_ggx(vec3 normal, vec3 halfway_vector, float roughness) {
    float a = roughness * roughness;
    float a_2 = a * a;
    float normal_dot_halfway = max(dot(normal, halfway_vector), 0.0);
    float normal_dot_halfway_2 = normal_dot_halfway * normal_dot_halfway;

    float num = a_2;
    float denom = (normal_dot_halfway_2 * (a_2 - 1.0) + 1.0);

    return a_2 / (PI * denom * denom);
}

float geometry_schlick_ggx(float normal_dot_view, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    return normal_dot_view / (normal_dot_view * (1.0 - k) + k);
}

float geometry_smith(vec3 normal, vec3 view, vec3 light, float roughness) {
    float normal_dot_view = max(dot(normal, view), 0.0);
    float normal_dot_light = max(dot(normal, light), 0.0);
    float ggx2 = geometry_schlick_ggx(normal_dot_view, roughness);
    float ggx1 = geometry_schlick_ggx(normal_dot_light, roughness);

    return ggx1 * ggx2;
}

void main(){
    vec3 light_dir = normalize(light_direction);
    vec3 view_vector = normalize(camera_pos - world_position);
    vec3 normal = normalize(world_normal);
    vec3 halfway_vector = normalize(light_dir + view_vector);

    float normal_distribution = normal_distribution_ggx(normal, halfway_vector, roughness);
    float geometry = geometry_smith(normal, view_vector, light_dir, roughness);
    vec3 F0 = vec3(0.04);

    F0 = mix(F0, albedo, metallic);
    vec3 fresnel = fresnel_schlick(dot(view_vector, halfway_vector), F0);

    vec3 numerator = normal_distribution * geometry * fresnel;
    float denominator = 4.0 * max(dot(normal, light_dir), 0.0) * max(dot(normal, view_vector), 0.0) + 0.0001;
    vec3 specular = numerator / denominator;

    float cosine_term = max(dot(normal, light_dir), 0.0);

    vec3 specular_coefficient = fresnel;
    vec3 diffuse_coefficient = vec3(1.0) - specular_coefficient;
    diffuse_coefficient *= 1.0 - metallic;

    float light_intensity = 5.0;

    vec3 outgoing_radiance = (diffuse_coefficient * albedo / PI  + specular) * cosine_term * light_intensity;

    vec3 color = outgoing_radiance;

    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0/2.2));

    frag_color = vec4(color, 1);
}`);

ctx.shaders["shader_pbr"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;
layout(location = 2) in vec2 texcoord_attrib;
layout(location = 3) in vec3 tangent_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 world_position;
out vec3 world_normal;
out vec2 texcoord;
out vec3 world_tangent;
out vec3 camera_pos;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    world_position = (m*vec4(position_attrib, 1)).xyz;
    mat3 inv_model = mat3(transpose(inverse(m)));
    world_normal = inv_model*normal_attrib;
    world_tangent = inv_model*tangent_attrib;
    texcoord = texcoord_attrib;

    camera_pos = -transpose(mat3(v)) * v[3].xyz;
}`,
`#version 300 es
precision highp float;

out vec4 frag_color;

uniform sampler2D albedo_texture;
uniform sampler2D metallic_texture;
uniform sampler2D roughness_texture;
uniform sampler2D normal_texture;
uniform sampler2D envmap_specular;
uniform sampler2D brdf_lut;
uniform sampler2D envmap_diffuse;

in vec3 world_position;
in vec3 world_normal;
in vec2 texcoord;
in vec3 world_tangent;
in vec3 camera_pos;

const float PI = 3.14159265359;

vec3 fresnel_schlick(float view_dot_halfway, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - view_dot_halfway, 0.0, 1.0), 5.0);
}

float normal_distribution_ggx(vec3 normal, vec3 halfway_vector, float roughness) {
    float a = roughness * roughness;
    float a_2 = a * a;
    float normal_dot_halfway = max(dot(normal, halfway_vector), 0.0);
    float normal_dot_halfway_2 = normal_dot_halfway * normal_dot_halfway;

    float num = a_2;
    float denom = (normal_dot_halfway_2 * (a_2 - 1.0) + 1.0);

    return a_2 / (PI * denom * denom);
}

float geometry_schlick_ggx(float normal_dot_view, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    return normal_dot_view / (normal_dot_view * (1.0 - k) + k);
}

float geometry_smith(vec3 normal, vec3 view, vec3 light, float roughness) {
    float normal_dot_view = max(dot(normal, view), 0.0);
    float normal_dot_light = max(dot(normal, light), 0.0);
    float ggx2 = geometry_schlick_ggx(normal_dot_view, roughness);
    float ggx1 = geometry_schlick_ggx(normal_dot_light, roughness);

    return ggx1 * ggx2;
}

vec3 fresnel_schlick_roughness(float view_dot_normal, vec3 F0, float roughness)
{
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - view_dot_normal, 0.0, 1.0), 5.0);
}

vec3 sample_lat_long(sampler2D tex, vec3 dir, float lod) {
    float u = atan(dir.z, dir.x) / (2.0 * 3.14159265359) + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5;
    return textureLod(tex, vec2(u, v), lod).rgb;
}

vec3 sample_lat_long(sampler2D tex, vec3 dir) {
    float u = atan(dir.z, dir.x) / (2.0 * 3.14159265359) + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5;

    vec2 uv = vec2(u, v);

    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);

    if (dx.x > 0.5)  dx.x -= 1.0;
    if (dx.x < -0.5) dx.x += 1.0;
    if (dy.x > 0.5)  dy.x -= 1.0;
    if (dy.x < -0.5) dy.x += 1.0;

    return textureGrad(tex, uv, dx, dy).rgb;
}

void main(){
    float metallic = 0.0;
    metallic = texture(metallic_texture, texcoord).r;

    float roughness = 0.0;
    roughness = texture(roughness_texture, texcoord).r;

    vec3 albedo = vec3(1.0, 0.0, 0.0);
    albedo = texture(albedo_texture, texcoord).rgb;
    float gamma = 2.2;
    albedo = pow(albedo, vec3(gamma));

    vec3 F0 = vec3(0.04);
    F0 = mix(F0, albedo, metallic);

    vec3 view_vector = normalize(camera_pos - world_position);

    vec3 normal = normalize(world_normal);
    vec3 tangent = normalize(world_tangent);
    tangent = normalize(tangent - dot(tangent, normal) * normal);
    vec3 bitangent = cross(tangent, normal);
    mat3 tbn_matrix = mat3(tangent, bitangent, normal);
    vec3 normal_map = texture(normal_texture, texcoord).rgb;
    normal_map = normal_map * 2.0 - vec3(1.0);
    normal_map = normalize(tbn_matrix * normal_map);

    normal_map = world_normal;
    vec3 reflection_vector = reflect(-view_vector, normal_map);

    vec3 specular_factor = fresnel_schlick_roughness(max(dot(normal_map, view_vector), 0.0), F0, roughness);
    vec3 diffuse_factor = (vec3(1.0) - specular_factor) * (1.0 - metallic);

    const float MAX_REFLECTION_LOD = 8.0;
    vec3 flipped_reflection = -vec3(reflection_vector.x, reflection_vector.y, reflection_vector.z);
    vec3 prefiltered_specular = sample_lat_long(envmap_specular, flipped_reflection, roughness * MAX_REFLECTION_LOD).rgb;

    vec2 brdf = texture(brdf_lut, vec2(max(dot(normal_map, view_vector), 0.0), roughness)).rg;
    vec3 specular = prefiltered_specular * (specular_factor * brdf.x + brdf.y);

    vec3 irradiance = sample_lat_long(envmap_diffuse, normal_map).rgb;
    vec3 diffuse = irradiance * albedo;

    vec3 color = diffuse_factor * diffuse + specular;

    color = pow(color, vec3(1.0 / 2.2));

    frag_color = vec4(color, 1);
}`);

ctx.scenes = {
    "scene_charges": {id: "scene_charges", el: null, ratio: 3, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        charges: []},
    "scene_electric_field": {id: "scene_electric_field", el: null, ratio: 2.3, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 60, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        charges: [], field_lines: [], vector_field: []},
    "scene_wave": {el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 60, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.4, 0.2, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        }},
    "scene_spectrum": {el: null, ratio: 2.5, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 20, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        }},
    "scene_field_gradient": {id: "scene_field_gradient", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 60, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 2.0
            }
        }},
    "scene_relativity": {id: "scene_relativity", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 60, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        cable_y_pos: 1.3, num_charges: 100, set_charges_spacing: -1, spacing_positive: 0.28, spacing_negative: 0.28,
        charges: [], reference_frame: 0},
    "scene_induction": {id: "scene_induction", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.4, 0, 0],
                pivot: [0, 0.5, 0],
                zoom: 7.0
            }
        }},
    "scene_ampere": {id: "scene_ampere", el: null, ratio: 2.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.4, 0, 0],
                pivot: [1, 0.5, 0],
                zoom: 6.0
            }
        }},
    "scene_led": {id: "scene_led", el: null, ratio: 1.7, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 10.0
            }
        }},
    "scene_bulb": {id: "scene_bulb", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 60, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.2, -0.6, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        particles: []},
    "scene_bulb_graphs": {id: "scene_bulb_graphs", el: null, ratio: 3.5, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 30, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        }},
    "scene_spd": {id: "scene_spd", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
        fov: 30, z_near: 0.1, z_far: 1000,
        position: [0, 0, 0], rotation: [0, 0, 0],
        up_vector: [0, 1, 0],
        view_matrix: mat4_identity(),
        orbit: {
            rotation: [0, 0, 0],
            pivot: [0, 0, 0],
            zoom: 3.0,
        },
        current_selection: 0
    }},
    "scene_spd_lamp": {id: "scene_spd_lamp", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
        fov: 30, z_near: 0.1, z_far: 1000,
        position: [0, 0, 0], rotation: [0, 0, 0],
        up_vector: [0, 1, 0],
        view_matrix: mat4_identity(),
        orbit: {
            rotation: [0, 0, 0],
            pivot: [0, 0, 0],
            zoom: 3.0,
        },
        current_selection: 0
    }},
    "scene_apple_reflectance": {id: "scene_apple_reflectance", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
        fov: 30, z_near: 0.1, z_far: 1000,
        position: [0, 0, 0], rotation: [0, 0, 0],
        up_vector: [0, 1, 0],
        view_matrix: mat4_identity(),
        orbit: {
            rotation: [0, 0, 0],
            pivot: [0, 0, 0],
            zoom: 3.0,
        },
        current_selection: 0
    }},
    "scene_spd_sun_space": {id: "scene_spd_sun_space", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
        fov: 30, z_near: 0.1, z_far: 1000,
        position: [0, 0, 0], rotation: [0, 0, 0],
        up_vector: [0, 1, 0],
        view_matrix: mat4_identity(),
        orbit: {
            rotation: [0, 0, 0],
            pivot: [0, 0, 0],
            zoom: 3.0,
        },
        current_selection: 0
    }},
    "scene_apple": {id: "scene_apple", el: null, ratio: 1.7, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.3, 0.3, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        }},
    "scene_apple_lights": {id: "scene_apple_lights", el: null, ratio: 1.7, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.3, 0.3, 0],
                pivot: [0, 0, 0],
                zoom: 7.0
            }
        }},
    "scene_metamers": {id: "scene_metamers", el: null, ratio: 1.7, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.3, 0.3, 0],
                pivot: [0, 0, 0],
                zoom: 7.0
            }
        }},
    "scene_sun": {id: "scene_sun", el: null, ratio: 1.7, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.3, 0.3, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        }},
    "scene_reflection_3d": {id: "scene_reflection_3d", el: null, ratio: 2.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 5, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.5, 0, 0],
                pivot: [0, 0.1, 0],
                zoom: 7.0
            }
        }},
    "scene_snells": {id: "scene_snells", el: null, ratio: 1, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.7
            }
        }, square: true, square_resize: 0.4},
    "scene_fresnel": {id: "scene_fresnel", el: null, ratio: 1, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.7
            }
        }, square: true, square_resize: 0.4},
    "scene_reflection": {id: "scene_reflection", el: null, ratio: 1, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.7
            }
        }, square: true, square_resize: 0.4},
    "scene_total_internal_reflection": {id: "scene_total_internal_reflection", el: null, ratio: 1.4, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3
            }
        }},
    "scene_snells_window": {id: "scene_snells_window", el: null, ratio: 1.4, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 100, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [Math.PI/2, 0, 0],
                pivot: [0, 0, 0],
                zoom: 15.0
            }
        }, done_shader_texture_setup: false },
    "scene_roughness_micro": {id: "scene_roughness_micro", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.0
            }
        }},
    "scene_roughness_geometric_function": {id: "scene_roughness_geometric_function", el: null, ratio: 2, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 0.85
            }
        }},
    "scene_cosine_law": {id: "scene_cosine_law", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.1
            }
        }},
    "scene_roughness_macro": {id: "scene_roughness_macro", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.0
            }
        }},
    "scene_roughness_metal": {id: "scene_roughness_metal", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.0
            }
        }},
    "scene_roughness_non_metal": {id: "scene_roughness_non_metal", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 1.0
            }
        }},
    "scene_metals": {id: "scene_metals", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        done_shader_texture_setup: false
    },
    "scene_non_metals": {id: "scene_non_metals", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        done_shader_texture_setup: false
    },
    "scene_rusted_metal": {id: "scene_rusted_metal", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 3.0
            }
        },
        done_shader_texture_setup: false
    },
    "scene_normal_distribution_function": {id: "scene_normal_distribution_function", el: null, ratio: 2.2, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 2.5
            }
        },
    },
    "scene_geometric_function": {id: "scene_geometric_function", el: null, ratio: 2.2, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.5, 0, 0],
                pivot: [0, 0, 0],
                zoom: 2.5
            }
        },
    },
    "scene_fresnel_equation": {id: "scene_fresnel_equation", el: null, ratio: 2.2, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 2.5
            }
        },
    },
    "scene_pbr_demo": {id: "scene_pbr_demo", el: null, ratio: 2.2, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 70, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [-0.5, 0, 0],
                pivot: [0, 0, 0],
                zoom: 2.5
            }
        },
    },
    "scene_pbr_demo_grid": {id: "scene_pbr_demo_grid", el: null, ratio: 1, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 30, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 30
            }
        },  square: true, square_resize: 1
    },
};

function get_event_coordinates(e, element) {
    const rect = element.getBoundingClientRect();
    const is_touch = e.touches ? true : false;
    const client_x = is_touch ? e.touches[0].clientX : e.clientX;
    const client_y = is_touch ? e.touches[0].clientY : e.clientY;

    return {
        x: client_x - rect.left,
        y: client_y - rect.top
    };
}

function handle_interaction_end(e) {
    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        if(scene.is_dragging){
            scene.is_dragging = false;
            scene.last_pos = null;
            scene.dragging_rect = null;
        }
    }
}

function setup_scene_listeners(){
    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        scene.el = document.getElementById(scene_id);

        (function(scene_id, scene) {
            function handle_move(e) {
                if (e.touches) e.preventDefault();

                const coords = get_event_coordinates(e, scene.el);
                let hovered = false;

                for (let rect_id in scene.draggable_rects) {
                    if(rect_id != "scene" && scene.draggable_rects[rect_id].object.state != "dragged"){
                        scene.draggable_rects[rect_id].object.state = "idle";
                    }
                }
                for (let rect_id in scene.draggable_rects) {
                    scene.draggable_rects[rect_id].hovered = false;
                    const rect = scene.draggable_rects[rect_id].rect;
                    if (rect_id == "scene" || coords.x >= rect[0] && coords.x <= rect[2] &&
                        coords.y >= rect[1] && coords.y <= rect[3]) {
                        hovered = true;
                        if(rect_id != "scene" && scene.draggable_rects[rect_id].object.state != "dragged"){
                            scene.draggable_rects[rect_id].object.state = "hovered";
                        }
                        break;
                    }
                }
                scene.el.style.cursor = hovered ? "move" : "default";
            }

            function handle_start(e) {
                e.preventDefault();
                if (!e.touches && e.which !== 1) return;

                const coords = get_event_coordinates(e, scene.el);

                for (let rect_id in scene.draggable_rects) {
                    const rect = scene.draggable_rects[rect_id].rect;
                    if (rect_id == "scene" || coords.x >= rect[0] && coords.x <= rect[2] &&
                        coords.y >= rect[1] && coords.y <= rect[3]) {
                        scene.dragging_rect = rect_id;
                        scene.is_dragging = true;
                        scene.last_pos = [coords.x, coords.y];
                        if(rect_id != "scene"){
                            scene.draggable_rects[rect_id].object.state = "dragged";
                        }
                        break;
                    }
                }
            }

            function handle_end(e) {
                e.preventDefault();
                for (let rect_id in scene.draggable_rects) {
                    const rect = scene.draggable_rects[rect_id].rect;
                    if(rect_id != "scene" && scene.draggable_rects[rect_id].object.state == "dragged"){
                        scene.draggable_rects[rect_id].object.state = "idle";
                    }
                }
            }

            scene.el.removeEventListener("mousemove", scene.event_listener_mousemove);
            scene.el.removeEventListener("touchmove", scene.event_listener_touchmove);
            scene.el.removeEventListener("mousedown", scene.event_listener_mousedown);
            scene.el.removeEventListener("touchstart", scene.event_listener_touchstart);
            scene.event_listener_mousemove = scene.el.addEventListener("mousemove", handle_move);
            scene.event_listener_touchmove = scene.el.addEventListener("touchmove", handle_move);
            scene.event_listener_mousedown = scene.el.addEventListener("mousedown", handle_start);
            scene.event_listener_touchstart = scene.el.addEventListener("touchstart", handle_start);
            scene.event_listener_mouseup = scene.el.addEventListener("mouseup", handle_end);
            scene.event_listener_touchend = scene.el.addEventListener("touchend", handle_end);
        })(scene_id, scene);
    }
}

function handle_global_move(e) {
    if (e.touches) e.preventDefault();

    for(let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        if (!scene.is_dragging || !scene.last_pos) continue;

        const coords = get_event_coordinates(e, scene.el);
        let current_pos = [coords.x, coords.y];
        let pos_delta = vec2_sub(current_pos, scene.last_pos);
        let delta_angle = [2 * Math.PI / scene.width, Math.PI / scene.height];

        if(scene_id == "scene_charges" || scene_id == "scene_electric_field" || scene_id == "scene_relativity") {
            const charge = scene.charges.find(charge => charge.id == scene.dragging_rect);
            let padding = scene.width/10-30;
            current_pos[0] = Math.max(padding, Math.min(scene.width - padding, current_pos[0]));
            current_pos[1] = Math.max(padding, Math.min(scene.height - padding, current_pos[1]));
            let new_pos = screen_to_world_space(scene, current_pos, 3);
            charge.pos = new_pos;
            update_charge_pos(charge);
            update_drag_charges(scene);
            if(scene_id == "scene_electric_field") {
                update_electric_field(scene);
                update_vector_field(scene);
            }
        }

        if(scene.dragging_rect == "scene") {
            scene.camera.orbit.rotation = vec3_add(
                scene.camera.orbit.rotation,
                [-pos_delta[1] * delta_angle[1], -pos_delta[0] * delta_angle[0], 0]
            );
            scene.camera.orbit.rotation[0] = clamp(
                scene.camera.orbit.rotation[0],
                -Math.PI / 2,
                Math.PI / 2
            );
            update_camera_orbit(scene.camera);
            scene.camera_dirty = true;
        }
        scene.last_pos = current_pos;
    }
}

document.addEventListener("mousemove", handle_global_move);
document.addEventListener("touchmove", handle_global_move);
document.addEventListener("mouseup", handle_interaction_end);
document.addEventListener("touchend", handle_interaction_end);
setup_scene_listeners();

ctx.draw = function(drawable, custom_uniforms, custom_camera, custom_shader){
    if(drawable == null) return;
    if(drawable.vertex_buffer == null) return;
    const gl = this.gl;
    const shader = custom_shader ? ctx.shaders[custom_shader] : ctx.shaders[drawable.shader];

    if(this.previous_shader != drawable.shader || this.previous_scene != this.current_scene || ctx.current_scene.camera_dirty){
        gl.useProgram(shader.program);
        const scene = ctx.current_scene;

        if(custom_camera){
            update_camera_projection_matrix(custom_camera, scene.width/scene.height);
            update_camera_orbit(custom_camera);
            ctx.set_shader_uniform(shader, "p", custom_camera.projection_matrix);
            ctx.set_shader_uniform(shader, "v", custom_camera.view_matrix);
        }
        else{
            update_camera_projection_matrix(scene.camera, scene.width/scene.height);
            update_camera_orbit(scene.camera);
            ctx.set_shader_uniform(shader, "p", scene.camera.projection_matrix);
            ctx.set_shader_uniform(shader, "v", scene.camera.view_matrix);
        }
        this.previous_shader = drawable.shader;
        this.previous_scene = this.current_scene;
        this.current_scene.camera_dirty = true;
    }

    ctx.set_shader_uniform(shader, "time", this.time);
    gl.bindVertexArray(drawable.vertex_buffer.vao);
    this.set_shader_uniform(this.shaders[drawable.shader], "color", drawable.color);
    this.set_shader_uniform(this.shaders[drawable.shader], "m", drawable.transform);
    if(custom_uniforms){
        for(let custom_uniform in custom_uniforms){
            ctx.set_shader_uniform(shader, custom_uniform, custom_uniforms[custom_uniform]);
        }
    }

    gl.drawElements(gl.TRIANGLES, drawable.vertex_buffer.draw_count, gl.UNSIGNED_SHORT, 0);
}

ctx.drawables = [];

ctx.create_drawable = function(shader, mesh, color, transform, custom_vertex_attribs){
    let drawable = {
        shader: shader,
        vertex_buffer : mesh == null ? null : this.create_vertex_buffer(mesh.vertices, custom_vertex_attribs == null ? [
                            { name: "position_attrib", size: 3 },
                            { name: "normal_attrib", size: 3 }
                        ] : custom_vertex_attribs, mesh.indices),
        color: color,
        transform: transform
    };
    this.drawables.push(drawable);
    return drawable;
}

ctx.update_drawable_mesh = function(drawable, mesh){
    const gl = this.gl;
    if(drawable.vertex_buffer != null){
        gl.deleteVertexArray(drawable.vertex_buffer.vao);
        gl.deleteBuffer(drawable.vertex_buffer.vbo);
        gl.deleteBuffer(drawable.vertex_buffer.ebo);
    }
    drawable.vertex_buffer = this.create_vertex_buffer(mesh.vertices, [
                            { name: "position_attrib", size: 3 },
                            { name: "normal_attrib", size: 3 }
                        ], mesh.indices);
}

ctx.update_wave_3d = function(drawable, wave_param, lines_segments_3d) {
    const gl = this.gl;

    let points = [];
    for (let i = 0; i < wave_param.num_points; i++) {
        let t = i / (wave_param.num_points - 1);
        let x = t * wave_param.width;
        let y = Math.sin(x * wave_param.frequency * Math.PI + wave_param.time) * wave_param.amplitude;
        let z = t * wave_param.z_range;
        points.push([x, y, z]);
    }

    let mesh = create_line_3d(points, wave_param.thickness, lines_segments_3d);

    if(drawable.vertex_buffer == null){
        drawable.vertex_buffer = this.create_vertex_buffer(mesh.vertices, [
                                    { name: "position_attrib", size: 3 },
                                    { name: "normal_attrib", size: 3 }
                                ], mesh.indices);
    }
    else{
        gl.bindBuffer(gl.ARRAY_BUFFER, drawable.vertex_buffer.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.DYNAMIC_DRAW);
    }
}

function resize_framebuffer(gl, framebuffer, texture, renderbuffer, width, height) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        width, height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorage(
        gl.RENDERBUFFER, gl.DEPTH_COMPONENT16,
        width, height
    );
}

function resize_event(ctx){
    const pixel_ratio = window.devicePixelRatio || 1;

    const css_width = window.innerWidth;
    const css_height = window.innerHeight;

    ctx.gl.canvas.style.width = css_width + 'px';
    ctx.gl.canvas.style.height = css_height + 'px';

    ctx.gl.canvas.width = Math.floor(css_width * pixel_ratio);
    ctx.gl.canvas.height = Math.floor(css_height * pixel_ratio);

    ctx.pixel_ratio = pixel_ratio;

    resize_framebuffer(
        ctx.gl,
        postprocess_framebuffer,
        postprocess_texture,
        postprocess_renderbuffer,
        ctx.gl.canvas.width, ctx.gl.canvas.height
    );

    ctx.gl.bindFramebuffer(ctx.gl.FRAMEBUFFER, null);

    let width = document.body.clientWidth - parseInt(window.getComputedStyle(document.body).paddingLeft) - parseInt(window.getComputedStyle(document.body).paddingRight);
    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        scene.el = document.getElementById(scene_id);
        let height = width/scene.ratio;
        let scene_width = width;
        if(scene.square){
            scene_width *= scene.square_resize;
            height = scene_width;
        }
        scene.el.style.width = scene_width + "px";
        scene.el.style.height = height + "px";
        scene.width = scene_width;
        scene.height = height;
    }
    setup_scene_listeners();
    update_drag_charges(ctx.scenes["scene_charges"]);
    update_drag_charges(ctx.scenes["scene_electric_field"]);
}
resize_event(ctx);
addEventListener("resize", () => resize_event(ctx));

const lines_segments_3d = 8;

let wave_param = {
    num_points: 500,
    width: 3.7,
    amplitude: 0.5,
    frequency: 2,
    thickness: 0.03,
    z_range: 0,
    time: 0,
}

document.getElementById("amplitude-input").value = wave_param.amplitude;
document.getElementById("amplitude-input").addEventListener("input", (e) => {
    wave_param.amplitude = parseFloat(e.target.value);
});

document.getElementById("frequency-input").value = wave_param.frequency;
document.getElementById("frequency-input").addEventListener("input", (e) => {
    wave_param.frequency = parseFloat(e.target.value);
});

const red = [0.922, 0.204, 0.204];
const blue = [0.204, 0.443, 0.922];
const green = [0.143, 0.867, 0.095];

// scene_metals
let envmaps = {
    "hotel_room": {"path": "textures/hotel_room_1k.zip"},
};

const textures = {
    "gold_albedo": { path: "textures/gold_albedo.png", texture: null },
    "gold_metallic": { path: "textures/gold_metallic.png", texture: null },
    "gold_roughness": { path: "textures/gold_roughness.png", texture: null },
    "gold_normal": { path: "textures/gold_normal.png", texture: null },

    "copper_albedo": { path: "textures/copper_albedo.png", texture: null },
    "copper_metallic": { path: "textures/copper_metallic.png", texture: null },
    "copper_roughness": { path: "textures/copper_roughness.png", texture: null },
    "copper_normal": { path: "textures/copper_normal.png", texture: null },

    "plastic_albedo": { path: "textures/plastic_albedo.png", texture: null },
    "plastic_metallic": { path: "textures/plastic_metallic.png", texture: null },
    "plastic_roughness": { path: "textures/plastic_roughness.png", texture: null },
    "plastic_normal": { path: "textures/plastic_normal.png", texture: null },

    "rusted_metal_albedo": { path: "textures/rusted_metal_albedo.png", texture: null },
    "rusted_metal_metallic": { path: "textures/rusted_metal_metallic.png", texture: null },
    "rusted_metal_roughness": { path: "textures/rusted_metal_roughness.png", texture: null },
    "rusted_metal_normal": { path: "textures/rusted_metal_normal.png", texture: null },

    "brdf_lut": { path: "textures/brdf_lut.png", texture: null },

    "envmap_sky": { path: "textures/cloudy_puresky_1k.hdr", texture: null },
};

let gold_sphere = ctx.create_drawable("shader_pbr", create_uv_sphere_tangent(1, 32, 32, true), [0, 0, 0], translate_3d([-1.2, 0, 0]),
        [{ name: "position_attrib", size: 3 },
        { name: "normal_attrib", size: 3 },
        { name: "texcoord_attrib", size: 2 },
        { name: "tangent_attrib", size: 3 },]
    );

let copper_sphere = ctx.create_drawable("shader_pbr", create_uv_sphere_tangent(1, 32, 32, true), [0, 0, 0], translate_3d([1.2, 0, 0]),
        [{ name: "position_attrib", size: 3 },
        { name: "normal_attrib", size: 3 },
        { name: "texcoord_attrib", size: 2 },
        { name: "tangent_attrib", size: 3 },]
    );

let albedo_location =  null;
let metallic_location = null;
let roughness_location = null;
let normal_location = null;
let envmap_specular_location = null;
let brdf_lut_location = null;
let envmap_diffuse_location = null;
let envmap_sky_location = null;
// scene_metals
// scene_non_metals
let plastic_sphere = ctx.create_drawable("shader_pbr", create_uv_sphere_tangent(1, 32, 32, true), [0, 0, 0], translate_3d([0, 0, 0]),
    [{ name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
    { name: "tangent_attrib", size: 3 },]
);
// scene_non_metals
// scene_normal_distribution_function
let normal_distribution_sphere = ctx.create_drawable("shader_normal_distribution", create_uv_sphere_tangent(1, 64, 64, true), [0, 0, 0], translate_3d([0, 0, 0]),
    [{ name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
    { name: "tangent_attrib", size: 3 },]
);
let roughness_normal_distribution = 0.7;
document.getElementById("roughness-input-normal-distribution").value = roughness_normal_distribution;
document.getElementById("roughness-input-normal-distribution").addEventListener("input", (e) => {
    roughness_normal_distribution = parseFloat(e.target.value);
});
// scene_normal_distribution_function
// scene_geometric_function
let geometric_function_sphere = ctx.create_drawable("shader_geometric_function", create_uv_sphere_tangent(1, 64, 64, true), [0, 0, 0], translate_3d([0, 0, 0]),
    [{ name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
    { name: "tangent_attrib", size: 3 },]
);
let roughness_geometric_function = 0.7;

// scene_geometric_function
// scene_fresnel_equation
let fresnel_equation_sphere = ctx.create_drawable("shader_fresnel", create_uv_sphere_tangent(1, 64, 64, true), [0, 0, 0], translate_3d([0, 0, 0]),
    [{ name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
    { name: "tangent_attrib", size: 3 },]
);
let base_reflectance = [0.04, 0.04, 0.04];
document.getElementById("base-reflectance-input").value = base_reflectance[0];
document.getElementById("base-reflectance-input").addEventListener("input", (e) => {
    base_reflectance = [parseFloat(e.target.value), parseFloat(e.target.value), parseFloat(e.target.value)];
});
// scene_fresnel_equation
// scene_pbr_demo
let pbr_demo_sphere = ctx.create_drawable("shader_pbr_demo", create_uv_sphere_tangent(1, 64, 64, true), [0, 0, 0], translate_3d([0, 0, 0]),
    [{ name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
    { name: "tangent_attrib", size: 3 },]
);
function hex_to_rgb_float(hex) {
    hex = hex.replace(/^#/, "")
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255
    return [r, g, b]
}
function rgb_float_to_hex(rgb) {
    const r = Math.round(rgb[0] * 255).toString(16).padStart(2, "0")
    const g = Math.round(rgb[1] * 255).toString(16).padStart(2, "0")
    const b = Math.round(rgb[2] * 255).toString(16).padStart(2, "0")
    return "#" + r + g + b
}
let albedo_pbr_demo = [1, 0, 0];
document.getElementById("albedo-input-pbr-demo").value = rgb_float_to_hex(albedo_pbr_demo);
document.getElementById("albedo-input-pbr-demo").addEventListener("input", (e) => {
    albedo_pbr_demo = hex_to_rgb_float(e.target.value);
});
let metallic_pbr_demo = 0;
document.getElementById("metallic-input-pbr-demo").value = metallic_pbr_demo;
document.getElementById("metallic-input-pbr-demo").addEventListener("input", (e) => {
    metallic_pbr_demo = parseFloat(e.target.value);
});
let roughness_pbr_demo = 0.5;
document.getElementById("roughness-input-pbr-demo").value = roughness_pbr_demo;
document.getElementById("roughness-input-pbr-demo").addEventListener("input", (e) => {
    roughness_pbr_demo = parseFloat(e.target.value);
});
// scene_pbr_demo

// scene_rusted_metal
let rusted_metal_sphere = ctx.create_drawable("shader_pbr", create_uv_sphere_tangent(1, 64, 64, true), [0, 0, 0], translate_3d([0, 0, 0]),
    [{ name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
    { name: "tangent_attrib", size: 3 },]
);
// scene_rusted_metal

// scene_pbr_demo_grid
let pbr_demo_grid_spheres = [];
let pbr_demo_grid_spacing = 2.5;
let grid_size = 4;
for(let i = 0; i < grid_size; i++){
    for(let j = 0; j < grid_size; j++){
        let roughness = remap_value(i, 0, grid_size-1, 0, 1);
        let metallic = remap_value(j, 0, grid_size-1, 0.1, 1);
        pbr_demo_grid_spheres.push([
            ctx.create_drawable("shader_pbr_demo", create_uv_sphere_tangent(1, 64, 64, true), [0, 0, 0], translate_3d([pbr_demo_grid_spacing*(i-1.5), pbr_demo_grid_spacing*(j-1.5), 0]),
                [{ name: "position_attrib", size: 3 },
                { name: "normal_attrib", size: 3 },
                { name: "texcoord_attrib", size: 2 },
                { name: "tangent_attrib", size: 3 },]
            ), roughness, metallic]);
    }
}
let grid_start = -pbr_demo_grid_spacing * 1.5 - 2;
let x_axis_arrow = ctx.create_drawable("shader_basic",
        create_arrow_3d([[grid_start, grid_start, 0], [grid_start + pbr_demo_grid_spacing * 3 + 3, grid_start, 0]], 0.1, 32, 0.5, 0.3),
        [0, 0, 0], mat4_identity());
let y_axis_arrow = ctx.create_drawable("shader_basic",
        create_arrow_3d([[grid_start, grid_start, 0], [grid_start, grid_start + pbr_demo_grid_spacing * 3 + 3, 0]], 0.1, 32, 0.5, 0.3),
        [0, 0, 0], mat4_identity());
ctx.text_buffers["metallic_text"] = {text: "Metallic", color: [0, 0, 0], transform: mat4_identity()};
ctx.text_buffers["roughness_text"] = {text: "Roughness", color: [0, 0, 0], transform: mat4_identity()};
// scene_pbr_demo_grid

// scene_roughness_macro
let golden = [1.000, 0.834, 0.000];
let roughness_macro_line = ctx.create_drawable("shader_basic",
        create_line([[-1, -0.4, 0], [1, -0.4, 0]], 0.02),
        [0.570, 0.785, 1.000], mat4_identity());
let roughness_macro_body = ctx.create_drawable("shader_basic",
        create_rect([-1, -1-0.4, 0], [2, 1]),
        [0.8, 0.9, 1], mat4_identity());
let roughness_macro = 0.5;

let incoming_light_arrow_macro = ctx.create_drawable("shader_basic",
        create_arrow([0.6, 0.4, 0], [0, -0.4, 0], [0.015, 0.03,  0.07]),
        golden, mat4_identity());
let reflected_light_arrows_macro = [];
let n_reflect_rays = 8;
for(let i = 0; i < n_reflect_rays; i++){
    reflected_light_arrows_macro.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
}

function update_roughness_macro_scene(){
    for(let i = 0; i < n_reflect_rays; i++){
        let from = [0, -0.4, 0];
        let rays_spread = remap_value(roughness_macro, 0, 1, 0.2, Math.PI/4);
        let angle = remap_value(i, 0, n_reflect_rays-1, Math.PI/2+rays_spread, Math.PI-rays_spread);
        let to = [-Math.sin(angle), -Math.cos(angle), 0];
        to = vec3_scale(vec3_normalize(to), 0.8);
        ctx.update_drawable_mesh(
            reflected_light_arrows_macro[i],
            create_arrow(from, vec3_add(to, [0, -0.4, 0]), [0.015, 0.03,  0.07])
        );
    }
}

update_roughness_macro_scene();
document.getElementById("roughness-input-macro").value = roughness_macro;
document.getElementById("roughness-input-macro").addEventListener("input", (e) => {
    roughness_macro = 1-parseFloat(e.target.value);
    update_roughness_macro_scene();
});
// scene_roughness_macro

// scene_roughness_metal
let roughness_metal_y_offset = 0.2;
let roughness_metal_line = ctx.create_drawable("shader_basic",
        create_line([[-1, -0.4 + roughness_metal_y_offset, 0], [1, -0.4 + roughness_metal_y_offset, 0]], 0.02),
        [0.570, 0.785, 1.000], mat4_identity());
let roughness_metal_body = ctx.create_drawable("shader_basic",
        create_rect([-1, -1-0.4 + roughness_metal_y_offset, 0], [2, 1]),
        [0.8, 0.9, 1], mat4_identity());
let roughness_metal = 0.5;

let incoming_light_arrow_metal = ctx.create_drawable("shader_basic",
        create_arrow([0.6, 0.4 + roughness_metal_y_offset, 0], [0, -0.4 + roughness_metal_y_offset, 0], [0.015, 0.03,  0.07]),
        golden, mat4_identity());
let reflected_light_arrows_metal = [];
let refracted_light_arrows_metal = [];
for(let i = 0; i < n_reflect_rays; i++){
    reflected_light_arrows_metal.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
    refracted_light_arrows_metal.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
}
let x_sign_position = [-0.1, -0.4, 0];
let red_x_sign_first = ctx.create_drawable("shader_basic", create_line([
    vec3_add(x_sign_position, [-0.1, -0.1, 0]),
    vec3_add(x_sign_position, [0.1, 0.1, 0])
], 0.035), red, mat4_identity());
let red_x_sign_second = ctx.create_drawable("shader_basic", create_line([
    vec3_add(x_sign_position, [-0.1, 0.1, 0]),
    vec3_add(x_sign_position, [0.1, -0.1, 0])
], 0.035), red, mat4_identity());

function update_roughness_metal_scene(){
    for(let i = 0; i < n_reflect_rays; i++){
        let from = [0, -0.4 + roughness_metal_y_offset, 0];
        let rays_spread = remap_value(roughness_metal, 0, 1, 0.2, Math.PI/4);

        let reflect_angle = remap_value(i, 0, n_reflect_rays-1, Math.PI/2+rays_spread, Math.PI-rays_spread);
        let reflect_to = [-Math.sin(reflect_angle), -Math.cos(reflect_angle), 0];
        reflect_to = vec3_scale(vec3_normalize(reflect_to), 0.8);
        ctx.update_drawable_mesh(
            reflected_light_arrows_metal[i],
            create_arrow(from, vec3_add(reflect_to, [0, -0.4 + roughness_metal_y_offset, 0]), [0.015, 0.03,  0.07])
        );

        let n1 = 1.0;
        let n2 = 1.5;
        let incident_angle = Math.PI/2 - reflect_angle;
        let refract_angle = Math.asin((n1 * Math.sin(incident_angle)) / n2);

        refract_angle = refract_angle;

        let refract_to = [Math.sin(refract_angle), -Math.cos(refract_angle), 0];
        refract_to = vec3_scale(vec3_normalize(refract_to), 0.55);
        ctx.update_drawable_mesh(
            refracted_light_arrows_metal[i],
            create_arrow(from, vec3_add(refract_to, [0, -0.4 + roughness_metal_y_offset, 0]), [0.015, 0.03,  0.07])
        );
    }
}

update_roughness_metal_scene();
document.getElementById("roughness-input-metal").value = roughness_metal;
document.getElementById("roughness-input-metal").addEventListener("input", (e) => {
    roughness_metal = 1-parseFloat(e.target.value);
    update_roughness_metal_scene();
});

// scene_roughness_non_metal
let roughness_non_metal_y_offset = 0.2;

let roughness_non_metal_line = ctx.create_drawable("shader_basic",
    create_line([[-1, -0.4 + roughness_non_metal_y_offset, 0], [1, -0.4 + roughness_non_metal_y_offset, 0]], 0.02),
    [0.570, 0.785, 1.000], mat4_identity());
let roughness_non_metal_body = ctx.create_drawable("shader_basic",
    create_rect([-1, -1-0.4 + roughness_non_metal_y_offset, 0], [2, 1]),
    [0.8, 0.9, 1], mat4_identity());
let roughness_non_metal = 0.5;

let incoming_light_arrow_non_metal = ctx.create_drawable("shader_basic",
    create_arrow([0.6, 0.4 + roughness_non_metal_y_offset, 0], [0, -0.4 + roughness_non_metal_y_offset, 0], [0.015, 0.03,  0.07]),
    golden, mat4_identity());
let reflected_light_arrows_non_metal = [];
let refracted_light_arrows_non_metal = [];
let scattered_rays_non_metal = [];


for(let i = 0; i < n_reflect_rays; i++){
    reflected_light_arrows_non_metal.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
}

let n_refract_rays = 5;
for(let i = 0; i < n_refract_rays; i++){
    refracted_light_arrows_non_metal.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
    scattered_rays_non_metal.push(ctx.create_drawable("shader_basic", null, [0.515, 0.718, 0.920], mat4_identity()));
}

let non_metal_particles = [];
let density = 5;
function generate_non_metal_particles() {
    const num_particles = Math.floor(25 * density);
    const radius = 0.02;

    const grid_size = Math.ceil(Math.sqrt(num_particles));
    const cell_width = 2 / grid_size;
    const cell_height = 1 / grid_size;

    let particle_count = 0;
    for (let grid_x = 0; grid_x < grid_size && particle_count < num_particles; grid_x++) {
        for (let grid_y = 0; grid_y < grid_size && particle_count < num_particles; grid_y++) {
            const base_x = -1 + grid_x * cell_width + cell_width / 2;
            const base_y = -1.4 + roughness_non_metal_y_offset + grid_y * cell_height + cell_height / 2;

            const offset_x = (Math.random() - 0.5) * cell_width * 0.6;
            const offset_y = (Math.random() - 0.5) * cell_height * 0.6 - 0.1;

            const x = base_x + offset_x;
            const y = base_y + offset_y;
            const z = 0;

            if (x >= -1 + radius && x <= 1 - radius &&
                y >= -1.4 + roughness_non_metal_y_offset + radius && y <= -0.4 + roughness_non_metal_y_offset - radius) {

                const circle_mesh = create_circle([x, y, z], radius, 16);

                if (particle_count < non_metal_particles.length) {
                    ctx.update_drawable_mesh(non_metal_particles[particle_count], circle_mesh);
                } else {
                    const particle = ctx.create_drawable("shader_basic", circle_mesh, [0.515, 0.718, 0.920], mat4_identity());
                    non_metal_particles.push(particle);
                }
                particle_count++;
            }
        }
    }
}

function update_roughness_non_metal_scene(){
    let middle_reflect_angle = Math.PI/4;

    for(let i = 0; i < n_reflect_rays; i++){
        let from = [0, -0.4 + roughness_non_metal_y_offset, 0];
        let rays_spread = remap_value(roughness_non_metal, 0, 1, 0.2, Math.PI/4);
        let angle = remap_value(i, 0, n_reflect_rays-1, Math.PI/2+rays_spread, Math.PI-rays_spread);
        let to = [-Math.sin(angle), -Math.cos(angle), 0];
        to = vec3_scale(vec3_normalize(to), 0.8);
        ctx.update_drawable_mesh(
            reflected_light_arrows_non_metal[i],
            create_arrow(from, vec3_add(to, [0, -0.4 + roughness_non_metal_y_offset, 0]), [0.015, 0.03,  0.07])
        );
    }

    for(let i = 0; i < n_refract_rays; i++){
        let from = [0, -0.4 + roughness_non_metal_y_offset, 0];
        let n1 = 1.0;
        let n2 = 1.5;

        let rays_spread = remap_value(roughness_non_metal, 0, 1, 0.2, Math.PI/4);

        let reflect_angle = remap_value(i, 0, n_refract_rays-1, Math.PI/2+rays_spread, Math.PI-rays_spread);
        let incident_angle = Math.PI/2 - reflect_angle;

        let refract_angle = Math.asin((n1 * Math.sin(incident_angle)) / n2);

        let refract_to = [Math.sin(refract_angle), -Math.cos(refract_angle), 0];
        refract_to = vec3_scale(vec3_normalize(refract_to), 0.4);
        let ray_end = vec3_add(refract_to, [0, -0.4 + roughness_non_metal_y_offset, 0]);

        ctx.update_drawable_mesh(
            refracted_light_arrows_non_metal[i],
            create_arrow(from, ray_end, [0.015, 0.03, 0.07])
        );
    }
}

generate_non_metal_particles();
update_roughness_non_metal_scene();
document.getElementById("roughness-input-non-metal").value = roughness_non_metal;
document.getElementById("roughness-input-non-metal").addEventListener("input", (e) => {
    roughness_non_metal = 1-parseFloat(e.target.value);
    update_roughness_non_metal_scene();
});
// scene_roughness_non_metal
// scene_roughness_micro
function smooth_noise(x) {
    function fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function hash(n) {
        return Math.sin(n * 43758.5453123) * 0.5;
    }

    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const t = x - x0;
    const ft = fade(t);
    const v0 = hash(x0);
    const v1 = hash(x1);

    return v0 * (1 - ft) + v1 * ft;
}

function fbm(x, octaves = 5, persistence = 0.5, lacunarity = 2.0) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let max_amplitude = 0;

    for (let i = 0; i < octaves; i++) {
        total += smooth_noise(x * frequency) * amplitude;
        max_amplitude += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }

    return total / max_amplitude;
}

function ray_segment_intersect(ray_origin, ray_dir, seg_a, seg_b) {
    let v1 = vec2_sub(ray_origin, seg_a);
    let v2 = vec2_sub(seg_b, seg_a);
    let v3 = [-ray_dir[1], ray_dir[0]];

    let dot = vec2_dot(v2, v3);
    if (Math.abs(dot) < 1e-6) return null;

    let t1 = vec2_cross(v2, v1) / dot;
    let t2 = vec2_dot(v1, v3) / dot;

    if (t1 >= 0 && t2 >= 0 && t2 <= 1) {
        return vec2_add(ray_origin, vec2_scale(ray_dir, t1));
    }
    return null;
}

function reflect_ray(incident, normal) {
    let dot = vec2_dot(incident, normal);
    return vec2_sub(incident, vec2_scale(normal, 2 * dot));
}

function create_strip_mesh_from_line(points, height) {
    let vertices = [];
    let indices = [];
    let index = 0;

    for (let i = 0; i < points.length - 1; i++) {
        let [x1, y1, z1] = points[i];
        let [x2, y2, z2] = points[i + 1];

        let x1b = x1, y1b = y1 - height, z1b = z1;
        let x2b = x2, y2b = y2 - height, z2b = z2;

        vertices.push(
            x1, y1, z1, 0, 0, 0,
            x2, y2, z2, 0, 1, 0,
            x1b, y1b, z1b, 0, 0, 1,
            x2b, y2b, z2b, 0, 1, 1
        );

        indices.push(
            index, index + 2, index + 1,
            index + 1, index + 2, index + 3
        );

        index += 4;
    }

    return { vertices: vertices, indices: indices };
}


let roughness_micro_line = ctx.create_drawable("shader_basic", null, [0.570, 0.785, 1.000], mat4_identity());
let roughness_micro_body = ctx.create_drawable("shader_basic", null, [0.8, 0.9, 1], mat4_identity());
let roughness_micro = 0.5;
let seed = 0;

let incoming_light_arrows = [];
let reflected_light_arrows = [];
for(let i = 0; i < 6; i++){
    incoming_light_arrows.push(ctx.create_drawable("shader_basic", null, golden, mat4_identity()));
    reflected_light_arrows.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
}

function update_roughness_micro_scene(){
    // seed++;
    let roughness_micro_line_n = 20;
    let roughness_micro_line_points = [];
    let roughness_micro_line_start_x = -1;
    let roughness_micro_line_end_x = 1;
    let roughness_micro_line_length = Math.abs(roughness_micro_line_start_x)+Math.abs(roughness_micro_line_end_x);
    let roughness_micro_line_segment_length = roughness_micro_line_length/roughness_micro_line_n;
    for(let i = 0; i < roughness_micro_line_n; i++){
        let start_x = roughness_micro_line_start_x + i*roughness_micro_line_segment_length;
        let end_x = start_x + roughness_micro_line_segment_length;
        roughness_micro_line_points.push([start_x, fbm(start_x*5+seed)/remap_value(Math.pow(roughness_micro, 7), 0, 1, 4, 500)-0.4, 0]);
    }
    ctx.update_drawable_mesh(roughness_micro_line, create_line(roughness_micro_line_points, 0.02));
    ctx.update_drawable_mesh(roughness_micro_body, create_strip_mesh_from_line(roughness_micro_line_points, 1));

    for(let i = 0; i < 6; i++){
        let from = [i / 10 + 0.3, 0.4];
        let dir = vec2_normalize([-0.25, -0.3]);

        let closest_hit = null;
        let min_dist = Infinity;
        for (let j = 0; j < roughness_micro_line_points.length - 1; j++) {
            let p0 = roughness_micro_line_points[j];
            let p1 = roughness_micro_line_points[j + 1];

            let hit = ray_segment_intersect(from, dir, p0, p1);
            if (hit) {
                let d = vec2_magnitude(vec2_sub(hit, from));
                if (d < min_dist) {
                    min_dist = d;
                    closest_hit = { point: hit, segment: [p0, p1] };
                }
            }
        }

        let to = vec2_add(from, dir);
        ctx.update_drawable_mesh(incoming_light_arrows[i],
            create_arrow([...from, 0], [...closest_hit.point, 0], [0.012, 0.02, 0.06]));

        let [p0, p1] = closest_hit.segment;
        let tangent = vec2_normalize(vec2_sub(p1, p0));
        let normal = [-tangent[1], tangent[0]];
        let reflected = reflect_ray(dir, normal);
        let reflect_to = vec2_add(closest_hit.point, vec2_scale(reflected, 0.5));

        ctx.update_drawable_mesh(reflected_light_arrows[i],
            create_arrow([...closest_hit.point, 0], [...reflect_to, 0], [0.012, 0.02, 0.06]));
    }
}

update_roughness_micro_scene();
document.getElementById("roughness-input-micro").value = roughness_micro;
document.getElementById("roughness-input-micro").addEventListener("input", (e) => {
    roughness_micro = 1-parseFloat(e.target.value);
    update_roughness_micro_scene();
});

// scene_roughness_micro

// scene_roughness_geometric_function
let roughness_geometric_function_line = ctx.create_drawable("shader_basic", null, [0.570, 0.785, 1.000], mat4_identity());
let roughness_geometric_function_body = ctx.create_drawable("shader_basic", null, [0.8, 0.9, 1], mat4_identity());
let roughness_geometric_function_seed = 0;
let incoming_light_arrows_geometric_function = [];
let reflected_light_arrows_geometric_function = [];
let num_geometric_roughness_rays = 30;
let num_geometric_roughness_spacing = 0.1;
for(let i = 0; i < num_geometric_roughness_rays; i++){
    incoming_light_arrows_geometric_function.push(ctx.create_drawable("shader_basic", null, golden, mat4_identity()));
    reflected_light_arrows_geometric_function.push(ctx.create_drawable("shader_basic", null, [0.450, 0.725, 1.000], mat4_identity()));
}

let roughness_geometric_function_angle = rad(-120);
function update_roughness_geometric_function_scene() {
    // seed++;
    let roughness_geometric_function_line_n = 40;
    let roughness_geometric_function_line_points = [];
    let roughness_geometric_function_line_start_x = -2;
    let roughness_geometric_function_line_end_x = 2;
    let roughness_geometric_function_line_length =
        Math.abs(roughness_geometric_function_line_start_x) +
        Math.abs(roughness_geometric_function_line_end_x);
    let roughness_geometric_function_line_segment_length =
        roughness_geometric_function_line_length /
        roughness_geometric_function_line_n;

    let first_bump = {position : -0.5, width : 0.4, height : 0.6};

    let second_bump = {position : 0.5, width : 0.6, height : 0.5};

    function get_bump_type(x) {
        if (x > first_bump.position - first_bump.width / 2 &&
            x < first_bump.position + first_bump.width / 2) {
            return 'first';
        } else if (x > second_bump.position - second_bump.width / 2 &&
                   x < second_bump.position + second_bump.width / 2) {
            return 'second';
        }
        return null;
    }

    let segment_bump_info = [];

    for (let i = 0; i < roughness_geometric_function_line_n; i++) {
        let start_x = roughness_geometric_function_line_start_x +
                      i * roughness_geometric_function_line_segment_length;
        let y = -0.3;
        let bump_type = null;

        if (start_x > first_bump.position - first_bump.width / 2 &&
            start_x < first_bump.position + first_bump.width / 2) {
            y += first_bump.height *
                 Math.sin((start_x - first_bump.position + first_bump.width / 2) *
                          Math.PI * (2.5));
            bump_type = 'first';
        } else if (start_x > second_bump.position - second_bump.width / 2 &&
                   start_x < second_bump.position + second_bump.width / 2) {
            y += second_bump.height *
                 Math.sin((start_x - second_bump.position + second_bump.width / 2) *
                          Math.PI * (2));
            bump_type = 'second';
        }

        roughness_geometric_function_line_points.push([ start_x, y, 0 ]);
        segment_bump_info.push(bump_type);
    }

    ctx.update_drawable_mesh(
        roughness_geometric_function_line,
        create_line(roughness_geometric_function_line_points, 0.02));
    ctx.update_drawable_mesh(
        roughness_geometric_function_body,
        create_strip_mesh_from_line(roughness_geometric_function_line_points, 1));

    let first_hit_first_bump = [];
    let first_hit_second_bump = [];
    let second_hit_first_bump = [];
    let second_hit_second_bump = [];

    for (let i = 0; i < num_geometric_roughness_rays; i++) {
        let from = [ -1 + i * num_geometric_roughness_spacing, 0.4 ];
        let dir = vec2_normalize([
            Math.cos(roughness_geometric_function_angle),
            Math.sin(roughness_geometric_function_angle)
        ]);
        let closest_hit = null;
        let min_dist = Infinity;
        let hit_segment_index = -1;

        for (let j = 0; j < roughness_geometric_function_line_points.length - 1;
             j++) {
            let p0 = roughness_geometric_function_line_points[j];
            let p1 = roughness_geometric_function_line_points[j + 1];
            let hit = ray_segment_intersect(from, dir, p0, p1);
            if (hit) {
                let d = vec2_magnitude(vec2_sub(hit, from));
                if (d < min_dist) {
                    min_dist = d;
                    closest_hit = {point : hit, segment : [ p0, p1 ]};
                    hit_segment_index = j;
                }
            }
        }

        if (closest_hit) {
            let initial_bump_hit = segment_bump_info[hit_segment_index];
            if (initial_bump_hit === 'first') {
                first_hit_first_bump.push(i);
            } else if (initial_bump_hit === 'second') {
                first_hit_second_bump.push(i);
            }

            let to = vec2_add(from, dir);

            let [p0, p1] = closest_hit.segment;
            let tangent = vec2_normalize(vec2_sub(p1, p0));
            let normal = [ -tangent[1], tangent[0] ];
            let reflected = reflect_ray(dir, normal);
            let reflect_to = vec2_add(closest_hit.point, vec2_scale(reflected, 0.9));

            let second_closest_hit = null;
            let second_min_dist = Infinity;
            let second_hit_segment_index = -1;

            for (let j = 0; j < roughness_geometric_function_line_points.length - 1;
                 j++) {
                let p0 = roughness_geometric_function_line_points[j];
                let p1 = roughness_geometric_function_line_points[j + 1];
                let hit = ray_segment_intersect(closest_hit.point, reflected, p0, p1);
                if (hit) {
                    let d = vec2_magnitude(vec2_sub(hit, closest_hit.point));
                    if (d > 0.001 && d < second_min_dist) {
                        second_min_dist = d;
                        second_closest_hit = {point : hit, segment : [ p0, p1 ]};
                        second_hit_segment_index = j;
                    }
                }
            }

            if (second_closest_hit) {
                let second_bump_hit = segment_bump_info[second_hit_segment_index];
                if (second_bump_hit === 'first') {
                    second_hit_first_bump.push(i);
                } else if (second_bump_hit === 'second') {
                    second_hit_second_bump.push(i);
                }
            }

            incoming_light_arrows_geometric_function[i].color = golden;
            reflected_light_arrows_geometric_function[i].color = golden;

            if (first_hit_second_bump.includes(i)) {
                incoming_light_arrows_geometric_function[i].color =
                    [ 0.922, 0.204, 0.204 ];
                ctx.update_drawable_mesh(incoming_light_arrows_geometric_function[i],
                                         create_arrow([...from, 0 ],
                                                      [...closest_hit.point, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
                ctx.update_drawable_mesh(reflected_light_arrows_geometric_function[i],
                                         create_arrow([ 1000, 1000, 0 ],
                                                      [ 1000, 1000, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
            } else if (second_hit_first_bump.includes(i)) {
                let reflect_to =
                    second_closest_hit
                        ? second_closest_hit.point
                        : vec2_add(closest_hit.point, vec2_scale(reflected, 0.9));
                incoming_light_arrows_geometric_function[i].color =
                    [ 0.204, 0.443, 0.922 ];
                reflected_light_arrows_geometric_function[i].color =
                    [ 0.204, 0.443, 0.922 ];
                ctx.update_drawable_mesh(incoming_light_arrows_geometric_function[i],
                                         create_arrow([...from, 0 ],
                                                      [...closest_hit.point, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
                ctx.update_drawable_mesh(reflected_light_arrows_geometric_function[i],
                                         create_arrow([...closest_hit.point, 0 ],
                                                      [...reflect_to, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
            }
            else if (first_hit_first_bump.includes(i)) {
                incoming_light_arrows_geometric_function[i].color =
                    [ 0.922, 0.204, 0.204 ];
                ctx.update_drawable_mesh(incoming_light_arrows_geometric_function[i],
                                         create_arrow([...from, 0 ],
                                                      [...closest_hit.point, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
                ctx.update_drawable_mesh(reflected_light_arrows_geometric_function[i],
                                         create_arrow([ 1000, 1000, 0 ],
                                                      [ 1000, 1000, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
            }
            else if (second_hit_second_bump.includes(i)) {
                let reflect_to =
                    second_closest_hit
                        ? second_closest_hit.point
                        : vec2_add(closest_hit.point, vec2_scale(reflected, 0.9));

                incoming_light_arrows_geometric_function[i].color = [0.204, 0.443, 0.922];
                reflected_light_arrows_geometric_function[i].color = [0.204, 0.443, 0.922];

                ctx.update_drawable_mesh(
                    incoming_light_arrows_geometric_function[i],
                    create_arrow([...from, 0], [...closest_hit.point, 0], [0.012, 0.02, 0.06])
                );

                ctx.update_drawable_mesh(
                    reflected_light_arrows_geometric_function[i],
                    create_arrow([...closest_hit.point, 0], [...reflect_to, 0], [0.012, 0.02, 0.06])
                );
            }
            else {
                ctx.update_drawable_mesh(incoming_light_arrows_geometric_function[i],
                                         create_arrow([...from, 0 ],
                                                      [...closest_hit.point, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
                ctx.update_drawable_mesh(reflected_light_arrows_geometric_function[i],
                                         create_arrow([...closest_hit.point, 0 ],
                                                      [...reflect_to, 0 ],
                                                      [ 0.012, 0.02, 0.06 ]));
            }
        }
    }
}

update_roughness_geometric_function_scene();


document.getElementById("angle-input-geometric-function").value = deg(roughness_geometric_function_angle);
document.getElementById("angle-input-geometric-function").addEventListener("input", (e) => {
    roughness_geometric_function_angle = rad(parseFloat(e.target.value));
    update_roughness_geometric_function_scene();
});

document.getElementById("roughness-input-geometric-function").value = roughness_geometric_function;
document.getElementById("roughness-input-geometric-function").addEventListener("input", (e) => {
    roughness_geometric_function = parseFloat(e.target.value);
    update_roughness_geometric_function_scene();
});
// scene_roughness_geometric_function

// scene_cosine_law
let cosine_law_line = ctx.create_drawable("shader_basic",
        create_line([[-1, -0.4, 0], [1, -0.4, 0]], 0.02),
        [0.570, 0.785, 1.000], mat4_identity());
let cosine_law_body = ctx.create_drawable("shader_basic",
        create_rect([-1, -1-0.4, 0], [2, 1]),
        [0.8, 0.9, 1], mat4_identity());

let cosine_law_angle = -45;
let cosine_law_incoming_light_arrows = [];
let cosine_law_num_arrows = 10;
let cosine_law_beam_width = 0.3;
let cosine_law_beam_distance = 1;
let cosine_law_center = [0, -0.4, 0];

let cosine_law_hit_line = ctx.create_drawable("shader_basic", null, golden, mat4_identity());
let cosine_law_normal_line = ctx.create_drawable("shader_basic", create_line_dashed([[0, -1, 0], [0, 1, 0]], 0.01, 0.03, 0.015), [0.4, 0.4, 0.4], mat4_identity());
let cosine_law_center_line = ctx.create_drawable("shader_basic", null, [0.4, 0.4, 0.4], mat4_identity());

for(let i = 0; i < cosine_law_num_arrows; i++){
    cosine_law_incoming_light_arrows.push(
        ctx.create_drawable("shader_basic", null, golden, mat4_identity())
    );
}

let cosine_law_angle_curve = ctx.create_drawable("shader_basic", null, [0.4, 0.4, 0.4], translate_3d([0, 0, 0]));

ctx.text_buffers["cosine_law_angle"] = {text: "θ", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0, 0, 0])), centered: true};
ctx.text_buffers["cosine_law_normal"] = {text: "n", color: [0, 0, 0], transform:  mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0.1, 0.6, 0])), centered: true};
ctx.text_buffers["cosine_law_light"] = {text: "ω", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0, 0, 0])), centered: true};

function update_cosine_law_scene(){
    let angle = rad(cosine_law_angle);
    for(let i = 0; i < cosine_law_num_arrows; i++){
        let perpendicular_spread = (i - (cosine_law_num_arrows - 1) / 2) * (cosine_law_beam_width / cosine_law_num_arrows);
        let line_spread = perpendicular_spread / Math.cos(angle);
        let to_x = cosine_law_center[0] + line_spread;
        let to_y = cosine_law_center[1];
        let to = [to_x, to_y, 0];
        let perp_vector = [Math.cos(angle), Math.sin(angle), 0];
        let beam_center_start = [cosine_law_center[0] - cosine_law_beam_distance * Math.sin(angle), cosine_law_center[1] + cosine_law_beam_distance * Math.cos(angle), 0];

        let from = vec3_add(beam_center_start, vec3_scale(perp_vector, perpendicular_spread));

        ctx.update_drawable_mesh(
            cosine_law_incoming_light_arrows[i],
            create_arrow(from, to, [0.012, 0.02, 0.05])
        );
    }
    let max_spread = (cosine_law_num_arrows - 1) / 2 * (cosine_law_beam_width / cosine_law_num_arrows);
    let hit_extent = max_spread / Math.cos(angle);
    let hit_start = [cosine_law_center[0] - hit_extent, cosine_law_center[1], 0];
    let hit_end = [cosine_law_center[0] + hit_extent, cosine_law_center[1], 0];
    ctx.update_drawable_mesh(cosine_law_hit_line,
        create_line([hit_start, hit_end], 0.03)
    );

    let beam_center_start = [cosine_law_center[0] - cosine_law_beam_distance * Math.sin(angle), cosine_law_center[1] + cosine_law_beam_distance * Math.cos(angle), 0];
    let beam_direction_start = beam_center_start;
    let beam_direction_end = cosine_law_center;

    ctx.update_drawable_mesh(cosine_law_center_line,
        create_line_dashed([beam_direction_start, beam_direction_end], 0.01, 0.03, 0.015)
    );

    let curve_n = 10;
    let points_cosine_law_angle_curve = [];
    let angle_1 = cosine_law_angle / curve_n;
    for(let i = 0; i < curve_n+1; i++){
        points_cosine_law_angle_curve.push(vec3_add(cosine_law_center, vec3_scale([-Math.sin(rad(angle_1*i)), Math.cos(rad(angle_1*i)), 0], 0.2)));
    }
    ctx.update_drawable_mesh(cosine_law_angle_curve, create_line(points_cosine_law_angle_curve, 0.01));
    ctx.text_buffers["cosine_law_angle"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            cosine_law_center,
            vec3_scale([-Math.sin(rad(cosine_law_angle)/2), Math.cos(rad(cosine_law_angle)/2), 0], 0.3))));
    ctx.text_buffers["cosine_law_light"].transform =  mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            cosine_law_center,
            vec3_scale([-Math.sin(rad(cosine_law_angle)), Math.cos(rad(cosine_law_angle)), 0], 1.1))));

    document.getElementById("lamberts_cosine_law_equation").setAttribute("data", "n\\dot\\omega = cos(\\theta) = cos("+cosine_law_angle.toFixed(1)+"°) = <b>"
                                        +Math.cos(rad(cosine_law_angle)).toFixed(2));
    update_math_element(document.getElementById("lamberts_cosine_law_equation"));
}

update_cosine_law_scene();
document.getElementById("cosine-law-angle").value = cosine_law_angle;
document.getElementById("cosine-law-angle").addEventListener("input", (e) => {
    cosine_law_angle = parseFloat(e.target.value);
    update_cosine_law_scene();
});

document.getElementById("lamberts_cosine_law_button_perpendicular").addEventListener("click", () => {
    cosine_law_angle = 0;
    update_cosine_law_scene();
});
document.getElementById("lamberts_cosine_law_button_grazing").addEventListener("click", () => {
    cosine_law_angle = 70;
    update_cosine_law_scene();
});
// scene_cosine_law
// scene_charges setup
function add_charge(scene, type, pos, charge_size = 0.25, border_size = 0.21, sign_size = 0.16, sign_thickness = 0.04, start_pos = 0, draggable = false, show_arrow = false){
    let charge_background = ctx.create_drawable("shader_basic", create_circle([0, 0, 0], charge_size, 32), [0.1, 0.1, 0.1], mat4_identity());
    let charge = ctx.create_drawable("shader_basic", create_circle([0, 0, 0], border_size, 32), type == "positive" ? red : blue, mat4_identity());
    let sign;

    if(type == "positive"){
        sign = ctx.create_drawable("shader_basic", create_plus_sign([0, 0, 0], sign_size, sign_thickness), [0.1, 0.1, 0.1], mat4_identity());
    }
    else{
        sign = ctx.create_drawable("shader_basic", create_minus_sign([0, 0, 0], sign_size, sign_thickness), [0.1, 0.1, 0.1], mat4_identity());
    }

    let arrow = ctx.create_drawable("shader_basic",
        create_arrow([0, 0, 0], [0, 0, 0], [0, 0, 0]), [0.3, 0.3, 0.3], translate_3d([0, 0, 0]));

    let id = type+""+scene.charges.length;
    scene.charges.push({id: id, draggable: draggable,
        show_arrow: show_arrow,
        type: type,
        charge: charge,
        charge_background:
        charge_background,
        sign: sign,
        arrow: arrow,
        pos: pos,
        start_pos: start_pos,
        size: charge_size,
        state: "idle",
        scale: 1.0,
        base_sizes: {
            charge: charge_size,
            border: border_size,
            sign: sign_size,
            thickness: sign_thickness
        }});
    update_charge_pos(scene.charges[scene.charges.length-1]);

    return id;
}

function update_charge_size(charge, scale){
    let charge_size = charge.base_sizes.charge * scale;
    let border_size = charge.base_sizes.border * scale;
    let sign_size   = charge.base_sizes.sign   * scale;

    charge.size = charge_size;

    ctx.update_drawable_mesh(charge.charge_background, create_circle([0, 0, 0], charge_size, 32));
    ctx.update_drawable_mesh(charge.charge, create_circle([0, 0, 0], border_size, 32));
    if(charge.type == "positive"){
        ctx.update_drawable_mesh(charge.sign, create_plus_sign([0, 0, 0], sign_size, 0.04 * scale));
    }
    else{
        ctx.update_drawable_mesh(charge.sign, create_minus_sign([0, 0, 0], sign_size, 0.04 * scale));
    }
    update_charge_pos(charge);
}

function update_charge_pos(charge){
    charge.charge.transform = translate_3d(charge.pos);
    charge.charge_background.transform = translate_3d(charge.pos);
    charge.sign.transform = translate_3d(charge.pos);
    charge.arrow.transform = translate_3d(charge.pos);
}

add_charge(ctx.scenes["scene_charges"], "positive", [0.5, 0.6, 0], 0.25, 0.21, 0.16, 0.04, 0, true, true);
add_charge(ctx.scenes["scene_charges"], "negative", [-2, -0.3, 0], 0.25, 0.21, 0.16, 0.04, 0, true, true);
add_charge(ctx.scenes["scene_charges"], "positive", [1.5, 0.3, 0], 0.25, 0.21, 0.16, 0.04, 0, true, true);

function update_drag_charges(scene){
    update_camera_projection_matrix(scene.camera, scene.width/scene.height);
    update_camera_orbit(scene.camera);

    const force_strength = 1.0;
    for (let i = 0; i < scene.charges.length; i++) {
        let charge = scene.charges[i];
        let force = [0, 0, 0];

        for (let j = 0; j < scene.charges.length; j++) {
            if (i == j) continue;

            let charge2 = scene.charges[j];

            let dir = vec3_sub(charge2.pos, charge.pos);
            let dist = vec3_magnitude(dir);
            dir = vec3_normalize(dir);

            let strength = (charge.type == charge2.type) ? -force_strength : force_strength;
            strength /= dist * dist;

            force = vec3_add(force, vec3_scale(dir, strength));
        }

        let direction = vec3_normalize(force);
        let magnitude = vec3_magnitude(force);
        magnitude = Math.min(magnitude, 10);
        const old_min = 0.08;
        const old_max = 0.6;
        const min = 0.8;
        const max = 1.8;
        let normalized = (magnitude - old_min) / (old_max - old_min);
        magnitude = min + normalized * (max - min);
        magnitude = Math.min(magnitude, 1.8);
        let arrow_length = 0.5;
        let arrow_thickness = magnitude;
        if(scene.id != "scene_electric_field" && charge.show_arrow){
            let new_mesh = create_arrow([0, 0, 0], vec3_scale(direction, arrow_length*arrow_thickness), vec3_scale([0.1, 0.15, 0.15], arrow_thickness));
            ctx.update_drawable_mesh(charge.arrow, new_mesh);
        }
    }

    scene.draggable_rects = [];
    for(const charge of scene.charges){
        if(!charge.draggable) continue;
        let rect_size = charge.size+0.1;
        let screen_space_charge = [
            ...world_to_screen_space(scene, scene.camera, [charge.pos[0]-rect_size, charge.pos[1]+rect_size, 0.1]),
            ...world_to_screen_space(scene, scene.camera, [charge.pos[0]+rect_size, charge.pos[1]-rect_size, 0.1])
        ];
        scene.draggable_rects[charge.id] = {rect: [...screen_space_charge], object: charge};
    }
}
update_drag_charges(ctx.scenes["scene_charges"]);
// scene_charges setup

// scene_snells
let snells_incidence_angle = -45;
let snells_len = 0.8;
let snells_len_curve = 0.3;
let snells_incident_ray_1 = ctx.create_drawable("shader_basic", null, golden, translate_3d([0, 0, 0]));
let snells_incident_ray_2 = ctx.create_drawable("shader_basic", null, golden, translate_3d([0, 0, 0]));
let snells_refracted_ray_1 = ctx.create_drawable("shader_basic", null, golden, translate_3d([0, 0, 0]));
let snells_refracted_ray_2 = ctx.create_drawable("shader_basic", null, golden, translate_3d([0, 0, 0]));
let medium_width = 2;
let medium_height = 1;
let snells_medium_1 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.8, 0.9, 1], translate_3d([-medium_width/2, -medium_height, 0]));
let snells_medium_2 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.960, 0.980, 1.000], translate_3d([-medium_width/2, 0, 0]));
let normal_line = ctx.create_drawable("shader_basic", create_line_dashed([[0, -1, 0], [0, 1, 0]], 0.01, 0.03, 0.015), [0.4, 0.4, 0.4], translate_3d([0, 0, 0]));
let medium_boundary = ctx.create_drawable("shader_basic", create_line([[-medium_width/2, 0, 0], [medium_width/2, 0, 0]], 0.02), [0.570, 0.785, 1.000], translate_3d([0, 0, 0]));
let snells_angle_1_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, 0, 0]));
let snells_angle_2_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, 0, 0]));
let snells_ior_1 = 1;
let snells_ior_2 = 2;

ctx.text_buffers["snells_angle_1"] = {text: "θ", color: [0, 0, 0], transform: mat4_identity(), centered: true};
ctx.text_buffers["snells_angle_1_sub"] = {text: "1", color: [0, 0, 0], transform: mat4_identity(), centered: false};
ctx.text_buffers["snells_angle_2"] = {text: "θ", color: [0, 0, 0], transform: mat4_identity(), centered: true};
ctx.text_buffers["snells_angle_2_sub"] = {text: "2", color: [0, 0, 0], transform: mat4_identity(), centered: false};

ctx.text_buffers["snells_ior_1"]     = {text: "n", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d([0.6,       0.6, 0])), centered: true};
ctx.text_buffers["snells_ior_1_sub"] = {text: "1", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0.6+0.04,  0.6-0.09, 0])), centered: false};
ctx.text_buffers["snells_ior_2"]     = {text: "n", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d([0.6,      -0.6, 0])), centered: true};
ctx.text_buffers["snells_ior_2_sub"] = {text: "2", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0.6+0.04, -0.6-0.09, 0])), centered: false};

let snells_refraction_angle = 0;

function update_snells_equations(){
    document.getElementById("snells_equation_1").setAttribute("data", "\\theta_{1} = "+Math.floor(snells_incidence_angle)+" degrees");
    update_math_element(document.getElementById("snells_equation_1"));
    document.getElementById("snells_equation_2").setAttribute("data", "n_{1} = "+snells_ior_1);
    update_math_element(document.getElementById("snells_equation_2"));
    document.getElementById("snells_equation_3").setAttribute("data", "n_{2} = "+snells_ior_2);
    update_math_element(document.getElementById("snells_equation_3"));
    document.getElementById("snells_equation_4").setAttribute("data", "\\theta_{2} = "+(180-Math.floor(deg(snells_refraction_angle)))+" degrees");
    update_math_element(document.getElementById("snells_equation_4"));
}

function update_snells_scene(){
    let incident_ray_start = vec3_scale([Math.sin(rad(snells_incidence_angle)), Math.cos(rad(snells_incidence_angle)), 0], snells_len);
    let incident_ray_vector = vec3_normalize(incident_ray_start);
    let incident_ray_end = [0, 0, 0];
    let incident_ray_mid_1 = vec3_scale(incident_ray_vector, snells_len/2 - 0.01);
    let incident_ray_mid = vec3_scale(incident_ray_vector, snells_len/2);
    let arrow_size = [0.025, 0.05, 0.08];

    ctx.update_drawable_mesh(snells_incident_ray_1, create_arrow(incident_ray_start, incident_ray_mid_1, arrow_size));
    ctx.update_drawable_mesh(snells_incident_ray_2, create_line([incident_ray_mid, incident_ray_end], arrow_size[0]));

    snells_refraction_angle = Math.asin((snells_ior_1/snells_ior_2)*Math.sin(rad(snells_incidence_angle)))+Math.PI;

    let refracted_ray_start = [0, 0, 0];
    let refracted_ray_vector = vec3_normalize([Math.sin(snells_refraction_angle), Math.cos(snells_refraction_angle), 0]);
    let refracted_ray_end = vec3_scale([Math.sin(snells_refraction_angle), Math.cos(snells_refraction_angle), 0], snells_len);
    let refracted_ray_mid_1 = vec3_scale(refracted_ray_vector, snells_len/2 + 0.01);
    let refracted_ray_mid = vec3_scale(refracted_ray_vector, snells_len/2);
    ctx.update_drawable_mesh(snells_refracted_ray_1, create_arrow(refracted_ray_start, refracted_ray_mid_1, arrow_size));
    ctx.update_drawable_mesh(snells_refracted_ray_2, create_line([refracted_ray_mid, refracted_ray_end], arrow_size[0]));

    snells_medium_1.color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], remap_value(snells_ior_2, 1, 2.5, 0, 1));
    snells_medium_2.color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], remap_value(snells_ior_1, 1, 2.5, 0, 1));

    let curve_n = 10;

    let points_snells_angle_1_curve = [];
    let angle_1 = snells_incidence_angle / curve_n;
    for(let i = 0; i < curve_n+1; i++){
        points_snells_angle_1_curve.push(vec3_scale([Math.sin(rad(angle_1*i)), Math.cos(rad(angle_1*i)), 0], snells_len_curve));
    }
    ctx.update_drawable_mesh(snells_angle_1_curve, create_line(points_snells_angle_1_curve, 0.01));

    let points_snells_angle_2_curve = [];
    let angle_2 = (snells_refraction_angle-Math.PI) / curve_n;
    for(let i = 0; i < curve_n+1; i++){
        let angle = snells_refraction_angle - angle_2*i;
        points_snells_angle_2_curve.push(vec3_scale([Math.sin(angle), Math.cos(angle), 0], snells_len_curve));
    }
    ctx.update_drawable_mesh(snells_angle_2_curve, create_line(points_snells_angle_2_curve, 0.01));

    ctx.text_buffers["snells_angle_1"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(rad(snells_incidence_angle)/2), Math.cos(rad(snells_incidence_angle)/2), 0], 0.5),
            [0.01, 0, 0])));
    ctx.text_buffers["snells_angle_1_sub"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(rad(snells_incidence_angle)/2), Math.cos(rad(snells_incidence_angle)/2), 0], 0.5),
            [0.05, -0.09, 0])));

    ctx.text_buffers["snells_angle_2"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(Math.PI/2+snells_refraction_angle/2), Math.cos(Math.PI/2+snells_refraction_angle/2), 0], 0.5),
            [0.01, 0, 0])));
    ctx.text_buffers["snells_angle_2_sub"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(Math.PI/2+snells_refraction_angle/2), Math.cos(Math.PI/2+snells_refraction_angle/2), 0], 0.5),
            [0.05, -0.09, 0])));

    update_snells_equations();
}

document.getElementById("snells-angle-input").value = snells_incidence_angle;
document.getElementById("snells-angle-input").addEventListener("input", function(e){
    snells_incidence_angle = parseFloat(e.target.value);
    update_snells_scene();
});
document.getElementById("snells-ior1-input").value = snells_ior_1;
document.getElementById("snells-ior1-input").addEventListener("input", function(e){
    snells_ior_1 = parseFloat(e.target.value);
    update_snells_scene();
});
document.getElementById("snells-ior2-input").value = snells_ior_2;
document.getElementById("snells-ior2-input").addEventListener("input", function(e){
    snells_ior_2 = parseFloat(e.target.value);
    update_snells_scene();
});
update_snells_scene();

document.getElementById("critical_angle_button").addEventListener("click", function(e){
    snells_ior_1 = 2.5;
    snells_ior_2 = 1;
    snells_incidence_angle = -50;
    document.getElementById("snells-angle-input").value = snells_incidence_angle;
    document.getElementById("snells-ior1-input").value = snells_ior_1;
    document.getElementById("snells-ior2-input").value = snells_ior_2;
    update_slider_background(document.getElementById("snells-angle-input"));
    update_slider_background(document.getElementById("snells-ior1-input"));
    update_slider_background(document.getElementById("snells-ior2-input"));
    update_snells_scene();
});
// scene_snells

// scene_fresnel
let fresnel_medium_1 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.8, 0.9, 1], translate_3d([-medium_width/2, -medium_height, 0]));
let fresnel_medium_2 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.960, 0.980, 1.000], translate_3d([-medium_width/2, 0, 0]));

let fresnel_incidence_angle = -50;
let fresnel_snells_len = 0.75;
let fresnel_snells_len_curve = 0.3;
let fresnel_ior_1 = 1;
let fresnel_ior_2 = 2.4;

let fresnel_incident_ray_1 = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, 0, 0]));
let fresnel_incident_ray_2 = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, 0, 0]));
let fresnel_refracted_ray_1 = ctx.create_drawable("shader_basic", null, [0, 0.6, 1], translate_3d([0, 0, 0]));
let fresnel_refracted_ray_2 = ctx.create_drawable("shader_basic", null, [0, 0.6, 1], translate_3d([0, 0, 0]));
let fresnel_reflected_ray_1 = ctx.create_drawable("shader_basic", null, [0.8, 0.8, 0], translate_3d([0, 0, 0]));
let fresnel_reflected_ray_2 = ctx.create_drawable("shader_basic", null, [0.8, 0.8, 0], translate_3d([0, 0, 0]));

let fresnel_angle_1_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, 0, 0]));
let fresnel_angle_2_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, 0, 0]));

ctx.text_buffers["fresnel_angle_1"] = {text: "θ", color: [0, 0, 0], transform: mat4_identity(), centered: true};
ctx.text_buffers["fresnel_angle_1_sub"] = {text: "1", color: [0, 0, 0], transform: mat4_identity(), centered: false};
ctx.text_buffers["fresnel_angle_2"] = {text: "θ", color: [0, 0, 0], transform: mat4_identity(), centered: true};
ctx.text_buffers["fresnel_angle_2_sub"] = {text: "2", color: [0, 0, 0], transform: mat4_identity(), centered: false};

ctx.text_buffers["fresnel_ior_1"]     = {text: "n", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d([0.6,       0.6, 0])), centered: true};
ctx.text_buffers["fresnel_ior_1_sub"] = {text: "1", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0.6+0.04,  0.6-0.09, 0])), centered: false};
ctx.text_buffers["fresnel_ior_2"]     = {text: "n", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d([0.6,      -0.6, 0])), centered: true};
ctx.text_buffers["fresnel_ior_2_sub"] = {text: "2", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d([0.6+0.04, -0.6-0.09, 0])), centered: false};

function fresnel_coefficients(ior1, ior2, angle_rad) {
    let cos_i = Math.cos(angle_rad);
    let sin_t = (ior1 / ior2) * Math.sin(angle_rad);

    if (Math.abs(sin_t) > 1) return { R: 1, T: 0 };

    let cos_t = Math.sqrt(1 - sin_t * sin_t);

    let rs = ((ior1 * cos_i - ior2 * cos_t) / (ior1 * cos_i + ior2 * cos_t)) ** 2;
    let rp = ((ior1 * cos_t - ior2 * cos_i) / (ior1 * cos_t + ior2 * cos_i)) ** 2;

    let R = 0.5 * (rs + rp);
    let T = 1 - R;

    return { R, T };
}

let fresnel_coefficient_r = 0;
let fresnel_coefficient_t = 0;

function update_fresnel_equations(){
    document.getElementById("fresnel_equation_1").setAttribute("data", "R_{\\theta} = "+fresnel_coefficient_r.toFixed(2));
    update_math_element(document.getElementById("fresnel_equation_1"));
    document.getElementById("fresnel_equation_2").setAttribute("data", "T_{\\theta} = "+fresnel_coefficient_t.toFixed(2));
    update_math_element(document.getElementById("fresnel_equation_2"));
}

function update_fresnel_scene() {
    let inc_angle_rad = rad(fresnel_incidence_angle);
    let { R, T } = fresnel_coefficients(fresnel_ior_1, fresnel_ior_2, Math.abs(inc_angle_rad));
    fresnel_coefficient_r = R;
    fresnel_coefficient_t = T;
    let medium1_color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], remap_value(fresnel_ior_2, 1, 2.5, 0, 1));
    let medium2_color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], remap_value(fresnel_ior_1, 1, 2.5, 0, 1));

    let golden_reflected = vec3_lerp(medium2_color, golden, R);
    let golden_refracted = vec3_lerp(medium1_color, golden, T);
    let arrow_size = [0.025, 0.05, 0.08];

    let inc_dir = vec3_normalize([Math.sin(inc_angle_rad), Math.cos(inc_angle_rad), 0]);
    let inc_start = vec3_scale(inc_dir, fresnel_snells_len);
    let inc_mid_1 = vec3_scale(inc_dir, fresnel_snells_len / 2 - 0.01);
    let inc_mid = vec3_scale(inc_dir, fresnel_snells_len / 2);
    ctx.update_drawable_mesh(fresnel_incident_ray_1, create_arrow(inc_start, inc_mid_1, arrow_size));
    ctx.update_drawable_mesh(fresnel_incident_ray_2, create_line([inc_mid, [0, 0, 0]], arrow_size[0]));
    fresnel_incident_ray_1.color = golden;
    fresnel_incident_ray_2.color = golden;

    let refraction_angle = Math.asin((fresnel_ior_1 / fresnel_ior_2) * Math.sin(inc_angle_rad)) + Math.PI;
    let refr_dir = vec3_normalize([Math.sin(refraction_angle), Math.cos(refraction_angle), 0]);
    let refr_mid_1 = vec3_scale(refr_dir, fresnel_snells_len / 2 + 0.01);
    let refr_mid = vec3_scale(refr_dir, fresnel_snells_len / 2);
    let refr_end = vec3_scale(refr_dir, fresnel_snells_len);
    ctx.update_drawable_mesh(fresnel_refracted_ray_1, create_arrow([0, 0, 0], refr_mid_1, arrow_size));
    ctx.update_drawable_mesh(fresnel_refracted_ray_2, create_line([refr_mid, refr_end], arrow_size[0]));
    fresnel_refracted_ray_1.color = golden_refracted;
    fresnel_refracted_ray_2.color = golden_refracted;

    let reflection_angle = -inc_angle_rad;
    let refl_dir = vec3_normalize([Math.sin(reflection_angle), Math.cos(reflection_angle), 0]);
    let refl_mid_1 = vec3_scale(refl_dir, fresnel_snells_len / 2 + 0.01);
    let refl_mid = vec3_scale(refl_dir, fresnel_snells_len / 2);
    let refl_end = vec3_scale(refl_dir, fresnel_snells_len);
    ctx.update_drawable_mesh(fresnel_reflected_ray_1, create_arrow([0, 0, 0], refl_mid_1, arrow_size));
    ctx.update_drawable_mesh(fresnel_reflected_ray_2, create_line([refl_mid, refl_end], arrow_size[0]));
    fresnel_reflected_ray_1.color = golden_reflected;
    fresnel_reflected_ray_2.color = golden_reflected;

    fresnel_medium_1.color = medium1_color;
    fresnel_medium_2.color = medium2_color;

    let curve_n = 10;
    let points_angle_1_curve = [];
    let angle_1 = fresnel_incidence_angle / curve_n;
    for (let i = 0; i <= curve_n; i++) {
        points_angle_1_curve.push(vec3_scale([Math.sin(rad(angle_1 * i)), Math.cos(rad(angle_1 * i)), 0], fresnel_snells_len_curve));
    }
    ctx.update_drawable_mesh(fresnel_angle_1_curve, create_line(points_angle_1_curve, 0.01));

    let points_angle_2_curve = [];
    let angle_2 = (refraction_angle - Math.PI) / curve_n;
    for (let i = 0; i <= curve_n; i++) {
        let angle = refraction_angle - angle_2 * i;
        points_angle_2_curve.push(vec3_scale([Math.sin(angle), Math.cos(angle), 0], fresnel_snells_len_curve));
    }
    ctx.update_drawable_mesh(fresnel_angle_2_curve, create_line(points_angle_2_curve, 0.01));

    fresnel_angle_2_curve.color = vec3_lerp([0, 0, 0], medium1_color, R);

    ctx.text_buffers["fresnel_angle_1"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(rad(fresnel_incidence_angle)/2), Math.cos(rad(fresnel_incidence_angle)/2), 0], 0.5),
            [0.01, 0, 0])));
    ctx.text_buffers["fresnel_angle_1_sub"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(rad(fresnel_incidence_angle)/2), Math.cos(rad(fresnel_incidence_angle)/2), 0], 0.5),
            [0.05, -0.09, 0])));

    ctx.text_buffers["fresnel_angle_2"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(Math.PI/2+refraction_angle/2), Math.cos(Math.PI/2+refraction_angle/2), 0], 0.5),
            [0.01, 0, 0])));
    ctx.text_buffers["fresnel_angle_2_sub"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(Math.PI/2+refraction_angle/2), Math.cos(Math.PI/2+refraction_angle/2), 0], 0.5),
            [0.05, -0.09, 0])));
    ctx.text_buffers["fresnel_angle_2"].color = vec3_lerp([0, 0, 0], medium1_color, R);
    ctx.text_buffers["fresnel_angle_2_sub"].color = vec3_lerp([0, 0, 0], medium1_color, R);
    update_fresnel_equations();
}

update_fresnel_scene();

document.getElementById("fresnel-angle-input").value = fresnel_incidence_angle;
document.getElementById("fresnel-angle-input").addEventListener("input", function(e){
    fresnel_incidence_angle = parseFloat(e.target.value);
    update_fresnel_scene();
});
document.getElementById("fresnel-ior1-input").value = fresnel_ior_1;
document.getElementById("fresnel-ior1-input").addEventListener("input", function(e){
    fresnel_ior_1 = parseFloat(e.target.value);
    update_fresnel_scene();
});
document.getElementById("fresnel-ior2-input").value = fresnel_ior_2;
document.getElementById("fresnel-ior2-input").addEventListener("input", function(e){
    fresnel_ior_2 = parseFloat(e.target.value);
    update_fresnel_scene();
});

document.getElementById("critical_angle_button_fresnel").addEventListener("click", function(e){
    fresnel_ior_1 = 2.5;
    fresnel_ior_2 = 1;
    fresnel_incidence_angle = -50;
    document.getElementById("fresnel-angle-input").value = fresnel_incidence_angle;
    document.getElementById("fresnel-ior1-input").value = fresnel_ior_1;
    document.getElementById("fresnel-ior2-input").value = fresnel_ior_2;
    update_slider_background(document.getElementById("fresnel-angle-input"));
    update_slider_background(document.getElementById("fresnel-ior1-input"));
    update_slider_background(document.getElementById("fresnel-ior2-input"));
    update_fresnel_scene();
});
// scene_fresnel

// scene_reflection
let offset_reflection_scene = -0.3;
let reflection_medium_1 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.8, 0.9, 1], translate_3d([-medium_width/2, -medium_height + offset_reflection_scene, 0]));
let reflection_medium_2 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.960, 0.980, 1.000], translate_3d([-medium_width/2, offset_reflection_scene, 0]));

let reflection_incidence_angle = -50;
let reflection_snells_len = 0.8;
let reflection_snells_len_curve = 0.3;

let reflection_incident_ray_1 = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, offset_reflection_scene, 0]));
let reflection_incident_ray_2 = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, offset_reflection_scene, 0]));
let reflection_reflected_ray_1 = ctx.create_drawable("shader_basic", null, [0.8, 0.8, 0], translate_3d([0, offset_reflection_scene, 0]));
let reflection_reflected_ray_2 = ctx.create_drawable("shader_basic", null, [0.8, 0.8, 0], translate_3d([0, offset_reflection_scene, 0]));

let reflection_angle_1_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, offset_reflection_scene, 0]));
let reflection_angle_2_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, offset_reflection_scene, 0]));

let reflection_medium_boundary = ctx.create_drawable("shader_basic", create_line([[-medium_width/2, 0, 0], [medium_width/2, 0, 0]], 0.02), [0.570, 0.785, 1.000], translate_3d([0, offset_reflection_scene, 0]));

ctx.text_buffers["reflection_angle_1"] = {text: "θ", color: [0, 0, 0], transform: mat4_identity(), centered: true};
ctx.text_buffers["reflection_angle_1_sub"] = {text: "1", color: [0, 0, 0], transform: mat4_identity(), centered: false};
ctx.text_buffers["reflection_angle_2"] = {text: "θ", color: [0, 0, 0], transform: mat4_identity(), centered: true};
ctx.text_buffers["reflection_angle_2_sub"] = {text: "2", color: [0, 0, 0], transform: mat4_identity(), centered: false};

function update_reflection_scene() {
    let inc_angle_rad = rad(reflection_incidence_angle);

    let medium2_color = [1, 1, 1];
    let medium1_color = [0.8, 0.9, 1];

    let arrow_size = [0.025, 0.05, 0.08];

    let inc_dir = vec3_normalize([Math.sin(inc_angle_rad), Math.cos(inc_angle_rad), 0]);
    let inc_start = vec3_scale(inc_dir, reflection_snells_len);
    let inc_mid_1 = vec3_scale(inc_dir, reflection_snells_len / 2 - 0.01);
    let inc_mid = vec3_scale(inc_dir, reflection_snells_len / 2);
    ctx.update_drawable_mesh(reflection_incident_ray_1, create_arrow(inc_start, inc_mid_1, arrow_size));
    ctx.update_drawable_mesh(reflection_incident_ray_2, create_line([inc_mid, [0, 0, 0]], arrow_size[0]));
    reflection_incident_ray_1.color = golden;
    reflection_incident_ray_2.color = golden;

    let reflection_angle = -inc_angle_rad;
    let refl_dir = vec3_normalize([Math.sin(reflection_angle), Math.cos(reflection_angle), 0]);
    let refl_mid_1 = vec3_scale(refl_dir, reflection_snells_len / 2 + 0.01);
    let refl_mid = vec3_scale(refl_dir, reflection_snells_len / 2);
    let refl_end = vec3_scale(refl_dir, reflection_snells_len);
    ctx.update_drawable_mesh(reflection_reflected_ray_1, create_arrow([0, 0, 0], refl_mid_1, arrow_size));
    ctx.update_drawable_mesh(reflection_reflected_ray_2, create_line([refl_mid, refl_end], arrow_size[0]));
    reflection_reflected_ray_1.color = golden;
    reflection_reflected_ray_2.color = golden;

    reflection_medium_1.color = medium1_color;
    reflection_medium_2.color = medium2_color;

    let curve_n = 10;
    let points_angle_1_curve = [];
    let angle_1 = reflection_incidence_angle / curve_n;
    for (let i = 0; i <= curve_n; i++) {
        points_angle_1_curve.push(vec3_scale([Math.sin(rad(angle_1 * i)), Math.cos(rad(angle_1 * i)), 0], reflection_snells_len_curve));
    }
    ctx.update_drawable_mesh(reflection_angle_1_curve, create_line(points_angle_1_curve, 0.01));

    let points_angle_2_curve = [];
    let angle_2 = reflection_incidence_angle / curve_n;
    for (let i = 0; i <= curve_n; i++) {
        points_angle_2_curve.push(vec3_scale([-Math.sin(rad(angle_1 * i)), Math.cos(rad(angle_1 * i)), 0], reflection_snells_len_curve));
    }
    ctx.update_drawable_mesh(reflection_angle_2_curve, create_line(points_angle_2_curve, 0.01));

    ctx.text_buffers["reflection_angle_1"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(inc_angle_rad/2), Math.cos(inc_angle_rad/2), 0], 0.5),
            [0.01, offset_reflection_scene, 0])));
    ctx.text_buffers["reflection_angle_1_sub"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(inc_angle_rad/2), Math.cos(inc_angle_rad/2), 0], 0.5),
            [0.05, offset_reflection_scene - 0.09, 0])));

    ctx.text_buffers["reflection_angle_2"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(reflection_angle/2), Math.cos(reflection_angle/2), 0], 0.5),
            [0.01, offset_reflection_scene, 0])));
    ctx.text_buffers["reflection_angle_2_sub"].transform = mat4_mat4_mul(scale_3d([0.002, 0.002, 0.002]), translate_3d(
        vec3_add(
            vec3_scale([Math.sin(reflection_angle/2), Math.cos(reflection_angle/2), 0], 0.5),
            [0.05, offset_reflection_scene - 0.09, 0])));
}

update_reflection_scene();

document.getElementById("reflection-angle-input").value = reflection_incidence_angle;
document.getElementById("reflection-angle-input").addEventListener("input", function(e){
    reflection_incidence_angle = parseFloat(e.target.value);
    update_reflection_scene();
    document.getElementById("law_reflection_equation").setAttribute("data", "\\theta_{1} = \\theta_{2} = "+Math.floor(reflection_incidence_angle)+" degrees");
    update_math_element(document.getElementById("law_reflection_equation"));
});
document.getElementById("law_reflection_equation").setAttribute("data", "\\theta_{1} = \\theta_{2} = "+Math.floor(reflection_incidence_angle)+" degrees");
update_math_element(document.getElementById("law_reflection_equation"));
// scene_reflection

// scene_total_internal_reflection
let tir_ior_1 = 1.33;
let tir_ior_2 = 1;

let tir_offset_y = -0.2;
let medium_width_tir = 4;
let medium_height_tir = 1.5;
let tir_medium_water = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width_tir, medium_height_tir]),
    [0.8, 0.9, 1],
    translate_3d([-medium_width_tir/2, -medium_height_tir + tir_offset_y, 0]));
let tir_medium_air = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width_tir, medium_height_tir]),
    [0.960, 0.980, 1.000],
    translate_3d([-medium_width/2, tir_offset_y, 0]));
let tir_medium_boundary = ctx.create_drawable("shader_basic", create_line([[-medium_width_tir/2, 0, 0], [medium_width_tir/2, 0, 0]], 0.02), [0.570, 0.785, 1.000], translate_3d([0, tir_offset_y, 0]));

let tir_rays = [];
let tir_secondary_rays = [];
let tir_num_rays = 30;

for(let i = 0; i < tir_num_rays; i++){
    let tir_ray = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, tir_offset_y, 0]));
    tir_rays.push(tir_ray);
    let tir_ray_reflected = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, tir_offset_y, 0]));
    tir_secondary_rays.push(tir_ray_reflected);
}

function line_intersection(p1, p2, p3, p4) {
    const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return null;
    const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
    const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;
    return [px, py];
}

let tir_angle_offset = 0;

function update_tir_scene() {
    tir_medium_water.color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], 0.8);
    tir_medium_air.color = [1, 1, 1];

    for(let i = 0; i < tir_num_rays; i++){
        let angle = remap_value(i, 0, tir_num_rays-1, rad(-70), rad(70)) + rad(tir_angle_offset);

        if(angle > Math.PI/2 || angle < -Math.PI/2){
            ctx.update_drawable_mesh(tir_rays[i], {vertices: [], indices: []});
            ctx.update_drawable_mesh(tir_secondary_rays[i], {vertices: [], indices: []});
            continue;
        }

        let start_point = [0, -medium_height_tir/2];
        let direction = [Math.sin(angle), Math.cos(angle)];

        let end_point = [start_point[0] + direction[0], start_point[1] + direction[1]];
        let intersection = line_intersection(start_point, end_point, [0, 0], [1, 0]);
        let line_thickness = 0.015;
        ctx.update_drawable_mesh(tir_rays[i], create_line([
            [...start_point, 0],
            [...intersection, 0]],
            line_thickness));
        tir_rays[i].color = golden;

        let refraction_angle = Math.asin((tir_ior_1/tir_ior_2)*Math.sin(angle))+Math.PI;

        let refracted_ray_start = [...intersection, 0];
        let refracted_ray_vector = vec3_normalize([Math.sin(refraction_angle), Math.cos(refraction_angle), 0]);
        let refracted_ray_end = vec3_scale([Math.sin(refraction_angle), Math.cos(refraction_angle), 0], -1);

        let { R, T } = fresnel_coefficients(tir_ior_1, tir_ior_2, angle);

        let reflected_ray_start = refracted_ray_start;
        let incident_2d = direction;
        let normal_2d = [0, 1];

        let dot_incident_normal = incident_2d[0]*normal_2d[0] + incident_2d[1]*normal_2d[1];
        let reflected_2d = [
            incident_2d[0] - 2 * dot_incident_normal * normal_2d[0],
            incident_2d[1] - 2 * dot_incident_normal * normal_2d[1]
        ];
        let reflected_ray_vector = vec3_normalize([reflected_2d[0], reflected_2d[1], 0]);
        let reflected_ray_end = vec3_add(reflected_ray_start, vec3_scale(reflected_ray_vector, 2));

        if(R == 1 && T == 0){
            ctx.update_drawable_mesh(tir_secondary_rays[i], create_line([
                reflected_ray_start,
                reflected_ray_end],
                line_thickness));
            tir_secondary_rays[i].color = golden;
        }
        else{
            ctx.update_drawable_mesh(tir_secondary_rays[i], create_line([
                refracted_ray_start,
                refracted_ray_end],
                line_thickness));
            tir_secondary_rays[i].color = golden;
        }
    }
}

update_tir_scene();

document.getElementById("tir-angle-input").value = tir_angle_offset;
document.getElementById("tir-angle-input").addEventListener("input", function(e){
    tir_angle_offset = parseFloat(e.target.value);
    update_tir_scene();
});
// scene_total_internal_reflection

// scene_snells_window
const water_plane_size = 2000;
let water_density = 0.0;
let water_ior = 1.33;
let water_surface = ctx.create_drawable(
            "shader_water",
            create_xz_plane(water_plane_size),
            [1, 0, 1],
            translate_3d([0, 0, 0])
        );
let skybox = ctx.create_drawable(
        "shader_skybox",
        create_uv_sphere_tangent(1, 32, 32, true), [0, 0, 0], translate_3d([0, 0, 0]),
        [
            { name: "position_attrib", size: 3 },
            { name: "normal_attrib", size: 3 },
            { name: "texcoord_attrib", size: 2 },
            { name: "tangent_attrib", size: 3 },
        ]
    );
document.getElementById("water-ior-input").value = water_ior;
document.getElementById("water-ior-input").addEventListener("input", function(e){
    water_ior = parseFloat(e.target.value);
});
// scene_snells_window

// scene_electric_field setup
add_charge(ctx.scenes["scene_electric_field"], "negative", [1.0, 0.8, 0], 0.25, 0.21, 0.16, 0.04, 0, true);
add_charge(ctx.scenes["scene_electric_field"], "positive", [-1.0, -0.8, 0], 0.25, 0.21, 0.16, 0.04, 0, true);

function update_electric_field(scene) {
    const lines = 32;
    const step_size = 0.03;
    const max_steps = 10000;

    function calculate_field_at_point(point, charges) {
        let field = [0, 0, 0];
        for (let charge of charges) {
            let dir = vec3_sub(charge.pos, point);
            let dist = vec3_magnitude(dir);
            if (dist < 0.1) continue;
            let strength = charge.id.includes("negative") ? 1 : -1;
            strength /= (dist * dist * dist);
            field = vec3_add(field, vec3_scale(dir, strength));
        }
        return vec3_normalize(field);
    }

    function rk4_step(point, charges) {
        let k1 = calculate_field_at_point(point, charges);
        let temp = vec3_add(point, vec3_scale(k1, step_size * 0.5));
        let k2 = calculate_field_at_point(temp, charges);
        temp = vec3_add(point, vec3_scale(k2, step_size * 0.5));
        let k3 = calculate_field_at_point(temp, charges);
        temp = vec3_add(point, vec3_scale(k3, step_size));
        let k4 = calculate_field_at_point(temp, charges);
        return vec3_scale(
            vec3_add(
                vec3_add(
                    vec3_scale(k1, 1 / 6),
                    vec3_scale(k2, 1 / 3)
                ),
                vec3_add(
                    vec3_scale(k3, 1 / 3),
                    vec3_scale(k4, 1 / 6)
                )
            ),
            step_size
        );
    }

    function generate_circle_points(center, radius, num_points) {
        let points = [];
        for (let i = 0; i < num_points; i++) {
            let angle = (i / num_points) * Math.PI * 2.0;
            let x = center[0] + radius * Math.cos(angle);
            let y = center[1] + radius * Math.sin(angle);
            points.push([x, y, 0]);
        }
        return points;
    }

    function integrate_field_line(start_point, charges) {
        let points = [start_point];
        let current_point = [...start_point];
        for (let i = 0; i < max_steps; i++) {
            let step = rk4_step(current_point, charges);
            if (vec3_magnitude(step) < 0.01) break;
            current_point = vec3_add(current_point, step);
            points.push([...current_point]);
            let too_close = charges.some(charge => vec3_magnitude(vec3_sub(current_point, charge.pos)) < 0.3);
            if (too_close) break;
            if (Math.abs(current_point[0]) > 5 || Math.abs(current_point[1]) > 5) break;
        }
        return points;
    }

    scene.field_lines = [];
    const positive_charges = scene.charges.filter(c => c.id.includes("positive"));

    for (let charge of positive_charges) {
        let start_points = generate_circle_points(charge.pos, 0.3, lines);
        for (let start_point of start_points) {
            let points = integrate_field_line(start_point, scene.charges);
            if (points.length > 10) {
                scene.field_lines.push(ctx.create_drawable(
                    "shader_basic",
                    create_line(points, 0.02, true),
                    [0.3, 0.3, 0.3],
                    translate_3d([0, 0, 0])
                ));
            }
        }
    }
}

function update_vector_field(scene) {
    let grid_size = 30;
    let grid_spacing = 0.3;
    let vector_scale = 0.2;
    let arrow_thickness = 0.02;
    let arrow_head_size = 0.045;

    function calculate_field_at_point(point, charges) {
        let field = [0, 0, 0];
        for (let charge of charges) {
            let dir = vec3_sub(charge.pos, point);
            let dist = vec3_magnitude(dir);
            if (dist < 0.1) continue;
            let strength = charge.id.includes("negative") ? 1 : -1;
            strength /= (dist * dist * dist);
            field = vec3_add(field, vec3_scale(dir, strength));
        }
        return field;
    }

    const arrows = [];
    const grid_offset = (grid_size - 1) * grid_spacing / 2;

    for (let i = 0; i < grid_size; i++) {
        for (let j = 0; j < grid_size; j++) {
            const x = i * grid_spacing - grid_offset;
            const y = j * grid_spacing - grid_offset;
            const point = [x, y, 0];

            const field = calculate_field_at_point(point, scene.charges);
            const magnitude = vec3_magnitude(field);

            let current_arrow_thickness = arrow_thickness;
            let current_arrow_head_size = arrow_head_size;
            let current_vector_scale = vector_scale;

            const normalized_field = vec3_normalize(field);
            const scaled_length = Math.min(0.4, Math.max(0.1, current_vector_scale * Math.pow(magnitude, 0.3)));
            const end_point = vec3_add(point, vec3_scale(normalized_field, scaled_length));

            const arrow = create_arrow(point, end_point, [current_arrow_thickness, current_arrow_head_size, current_arrow_head_size]);
            arrows.push(arrow);
        }
    }

    if (scene.vector_field.length == 0) {
        scene.vector_field = [];
        for (let arrow of arrows) {
            const arrow_drawable = ctx.create_drawable(
                "shader_basic",
                arrow,
                [0, 0, 0],
                translate_3d([0, 0, 0])
            );
            scene.vector_field.push(arrow_drawable);
        }
    } else {
        for (let i = 0; i < arrows.length; i++) {
            ctx.update_drawable_mesh(scene.vector_field[i], arrows[i]);
        }
    }
}

update_drag_charges(ctx.scenes["scene_electric_field"]);
update_electric_field(ctx.scenes["scene_electric_field"]);
update_vector_field(ctx.scenes["scene_electric_field"]);

let show_field_line = true;

document.getElementById("display-field-line").addEventListener("click", function(e){
    document.getElementById("display-field-line").classList.add("active");
    document.getElementById("display-vector-field").classList.remove("active");
    show_field_line = true;
});
document.getElementById("display-vector-field").addEventListener("click", function(e){
    document.getElementById("display-vector-field").classList.add("active");
    document.getElementById("display-field-line").classList.remove("active");
    show_field_line = false;
});
// scene_electric_field setup

// scene_relativity setup
function update_drag_charges_relativity(scene){
    update_camera_projection_matrix(scene.camera, scene.width/scene.height);
    update_camera_orbit(scene.camera);

    const force_strength = 1.0;

    let charge = scene.charges[0];
    let force = [0, 0, 0];
    let first_charge_y_pos = null;

    for (let j = 0; j < scene.charges.length; j++) {
        if (j == 0) continue;

        let charge2 = scene.charges[j];
        let charge2_pos = [charge2.pos[0], charge2.pos[1], charge2.pos[2]];
        if(first_charge_y_pos == null){
            first_charge_y_pos = charge2_pos[1];
        }
        charge2_pos[1] = first_charge_y_pos;

        let dir = vec3_sub(charge2_pos, charge.pos);
        let dist = vec3_magnitude(dir);
        dir = vec3_normalize(dir);

        let strength = (charge.type == charge2.type) ? -force_strength : force_strength;
        strength /= dist * dist;

        force = vec3_add(force, vec3_scale(dir, strength));
    }

    let direction = vec3_normalize(force);
    let magnitude = vec3_magnitude(force);
    magnitude = Math.min(magnitude, 10);
    const old_min = 0;
    const old_max = 0.6;
    const min = 0;
    const max = 1.8;
    let normalized = (magnitude - old_min) / (old_max - old_min);
    magnitude = min + normalized * (max - min);
    magnitude = Math.min(magnitude, 1.8);
    let arrow_length = magnitude/2;
    let arrow_thickness = magnitude;

    let new_mesh = create_arrow([0, 0, 0], vec3_scale(direction, arrow_length), vec3_scale([0.1, 0.15, 0.15], arrow_thickness, arrow_thickness, arrow_thickness));
    ctx.update_drawable_mesh(charge.arrow, new_mesh);
}

function setup_relativity_scene(scene){
    for(let i = 0; i < scene.num_charges; i++){
        let positive_pos = [i*scene.spacing_positive - (scene.num_charges-1)/2*scene.spacing_positive, scene.cable_y_pos, 0];
        add_charge(scene, "positive", positive_pos, 0.12, 0.095, 0.10, 0.02, positive_pos[0]);
    }
    for(let i = 0; i < scene.num_charges; i++){
        let negative_pos = [i*scene.spacing_negative - (scene.num_charges-1)/2*scene.spacing_negative, scene.cable_y_pos-0.28, 0];
        add_charge(scene, "negative", negative_pos, 0.12, 0.095, 0.10, 0.02, negative_pos[0]);
    }
}
let big_charge_id = add_charge(ctx.scenes["scene_relativity"], "positive", [0, 0, 0], 0.25, 0.21, 0.2, 0.05, -3.75, false, true);
let big_charge = ctx.scenes["scene_relativity"].charges.find(charge => charge.id == big_charge_id);
setup_relativity_scene(ctx.scenes["scene_relativity"]);
update_drag_charges_relativity(ctx.scenes["scene_relativity"]);
let cable = ctx.create_drawable("shader_basic",
    create_rect([-5, ctx.scenes["scene_relativity"].cable_y_pos-0.44, 0], [10, 0.6]),
    [0.5, 0.5, 0.5], translate_3d([0, 0, 0]));
ctx.create_drawable("shader_basic", create_rect([0, 0, 0], [2,2]), [0.9, 0.9, 0.9], mat4_identity())
let position_range = {x: [-3.5, 3.5], y: [-1.7, 1.7]};
let random_circles = [];
let random_circles_pos = [];
for(let i = 0; i < 60; i++){
    let x = position_range.x[0] + Math.random() * (position_range.x[1] - position_range.x[0]);
    let y = position_range.y[0] + Math.random() * (position_range.y[1] - position_range.y[0]);
    let min_size = 0.02;
    let max_size = 0.05;
    let size = min_size + Math.random() * (max_size - min_size);
    random_circles.push(ctx.create_drawable("shader_basic", create_circle([0, 0, 0], size, 32), [0.9, 0.9, 0.9], translate_3d([x, y, 0])));
    random_circles_pos.push([x, y, 0]);
}
// scene_relativity setup

// scene_spectrum setup
let wave_param_spectrum = {
    num_points: 500,
    width: 15,
    amplitude: 0.5,
    frequency: 2.75,
    thickness: 0.03,
    z_range: 0,
    time: 0,
};
document.getElementById("frequency-input-spectrum").value = 0.5;
document.getElementById("frequency-input-spectrum").addEventListener("input", (e) => {
    let value = parseFloat(e.target.value);
    wave_param_spectrum.frequency = 0.5 + (1-value) * (5-0.5);
    arrow.transform = translate_3d([-1.43 + value * (1.43 - (-1.43)) -0.075, -0.64, -0.9]);
});
let spectrum_wave = {vertex_buffer: null, shader: "shader_basic"};
spectrum_wave.transform = translate_3d([-7.5, 0.9, -10]);
ctx.update_wave_3d(spectrum_wave, wave_param_spectrum, lines_segments_3d);

let spectrum_background = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [3.8, 0.4]),
    [0.85, 0.85, 0.85], translate_3d([-2, -0.5, -1]));
let spectrum = ctx.create_drawable("shader_spectrum",
    create_rect([0, 0, 0], [0.8, 0.4]),
    [0, 0, 0], translate_3d([-0.4, -0.5, -1]));
let arrow = ctx.create_drawable("shader_basic",
    create_triangle([0, 0, 0], [0.15, 0.15]),
    [0, 0, 0], translate_3d([-0.075, -0.64, -0.9]));

ctx.text_buffers["gamma_ray_text_wavelength"] = {text: "0.01nm              10nm                               400nm                       700nm                       1 mm                      100 km", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0012, 0.0012, 0.0012]),
                    translate_3d([-1.2, -0.02, 0]))};
ctx.text_buffers["gamma_ray_text"] = {text: "Gamma rays          X rays              UV                                                           IR        Microwave        Radio waves", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0012, 0.0012, 0.0012]),
                    translate_3d([-1.2, -0.245, 0]))};

function wavelength_to_rgb(value, start, end) {
    let wavelength = 380 + (700 - 380) * ((start - value) / (start - end));

    let r = 0.0, g = 0.0, b = 0.0;

    if (wavelength >= 380.0 && wavelength < 450.0) {
        r = 0.5 * (450.0 - wavelength) / (450.0 - 380.0);
        g = 0.0;
        b = 1.0;
    }
    else if (wavelength >= 450.0 && wavelength < 540.0) {
        r = 0.0;
        g = (wavelength - 450.0) / (540.0 - 450.0);
        b = 1.0 - (wavelength - 450.0) / (540.0 - 450.0);
    }
    else if (wavelength >= 540.0 && wavelength < 590.0) {
        r = (wavelength - 540.0) / (590.0 - 540.0);
        g = 1.0;
        b = 0.0;
    }
    else if (wavelength >= 590.0 && wavelength <= 700.0) {
        r = 1.0;
        g = 1.0 - (wavelength - 590.0) / (700.0 - 590.0);
        b = 0.0;
    }

    function smoothstep(edge0, edge1, x) {
        let t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    let fade = smoothstep(370.0, 420.0, wavelength) * smoothstep(700.0, 650.0, wavelength);
    return [r * fade, g * fade, b * fade];
}
// scene_spectrum setup
// scene_wave setup
let wave_3d = {vertex_buffer: null, shader: "shader_basic"};
ctx.update_wave_3d(wave_3d, wave_param, lines_segments_3d);

let x_axis = ctx.create_drawable("shader_basic",
    create_arrow_3d([[0, 0, 0], [4.5, 0, 0]], 0.02, 32),
    [0.3, 0.3, 0.3], translate_3d([-2.5, 0, 0]));

let y_axis = ctx.create_drawable("shader_basic",
    create_arrow_3d([[0, -1.5, 0], [0, 1, 0]], 0.02, 32),
    [0.3, 0.3, 0.3], translate_3d([-1.5, 0, 0]));

let z_axis = ctx.create_drawable("shader_basic",
    create_arrow_3d([[0, 0, -1], [0, 0, 1]], 0.02, 32),
    [0.3, 0.3, 0.3], translate_3d([-1.5, 0, 0]));
// scene_wave setup

// scene_field_gradient setup
let plane = ctx.create_drawable("shader_plane",
    create_rect([0, 0, 0], [6, 2.4]),
    [0, 0, 0], translate_3d([-3, -1.2, 0]));
// scene_field_gradient setup

// scene_induction setup
function update_magnetic_field(north_pole, south_pole) {
    const lines = 31;
    const step_size = 0.03;
    const max_steps = 1000;

    function calculate_field_at_point(point) {
        let field = [0, 0, 0];

        let dir_north = vec3_sub(north_pole, point);
        let dist_north = vec3_magnitude(dir_north);
        if (dist_north >= 0.1) {
            let strength_north = -1 / (dist_north * dist_north);
            field = vec3_add(field, vec3_scale(dir_north, strength_north));
        }

        let dir_south = vec3_sub(south_pole, point);
        let dist_south = vec3_magnitude(dir_south);
        if (dist_south >= 0.1) {
            let strength_south = 1 / (dist_south * dist_south);
            field = vec3_add(field, vec3_scale(dir_south, strength_south));
        }

        return vec3_normalize(field);
    }

    function rk4_step(point) {
        let k1 = calculate_field_at_point(point);
        let temp = vec3_add(point, vec3_scale(k1, step_size * 0.5));
        let k2 = calculate_field_at_point(temp);
        temp = vec3_add(point, vec3_scale(k2, step_size * 0.5));
        let k3 = calculate_field_at_point(temp);
        temp = vec3_add(point, vec3_scale(k3, step_size));
        let k4 = calculate_field_at_point(temp);
        return vec3_scale(
            vec3_add(
                vec3_add(
                    vec3_scale(k1, 1 / 6),
                    vec3_scale(k2, 1 / 3)
                ),
                vec3_add(
                    vec3_scale(k3, 1 / 3),
                    vec3_scale(k4, 1 / 6)
                )
            ),
            step_size
        );
    }

    function generate_circle_points(center, radius, num_points) {
        let points = [];
        for (let i = 0; i < num_points; i++) {
            let angle = (i / num_points) * Math.PI * 2.0;
            let x = center[0] + radius * Math.cos(angle);
            let y = center[1] + radius * Math.sin(angle);
            points.push([x, y, 0]);
        }
        return points;
    }

    function integrate_field_line(start_point) {
        let points = [start_point];
        let current_point = [...start_point];
        for (let i = 0; i < max_steps; i++) {
            let step = rk4_step(current_point);
            current_point = vec3_add(current_point, step);
            points.push([...current_point]);

            let too_close_north = vec3_magnitude(vec3_sub(current_point, north_pole)) < 0.3;
            let too_close_south = vec3_magnitude(vec3_sub(current_point, south_pole)) < 0.3;

            if (too_close_north || too_close_south) break;
            if (Math.abs(current_point[0]) > 5 || Math.abs(current_point[1]) > 5) break;
        }
        return points;
    }

    let field_lines = [];
    let start_points = generate_circle_points(north_pole, 0.3, lines);
    for (let start_point of start_points) {
        let points = integrate_field_line(start_point);
        if (points.length > 10) {
            field_lines.push(ctx.create_drawable(
                "shader_field",
                create_line_3d(points, 0.01, 16),
                [0.3, 0.3, 0.3],
                translate_3d([0, 0, 0])
            ));
        }
    }
    return field_lines;
}

let magnet_y_pos = 0.85;
let magnetic_field_drawables = update_magnetic_field([-0.25, magnet_y_pos, 0], [0.25, magnet_y_pos, 0]);
let coil_transform = mat4_mat4_mul(
    translate_3d([0, -1.5, 0.3]),
    scale_3d([0.4, 0.4, 0.4]),
);
let voltmeter_transform =  mat4_mat4_mul(
    translate_3d([0, -1, 1]),
    scale_3d([0.4, 0.4, 0.4]),
);
let coil = ctx.create_drawable("shader_shaded", null, [0.722, 0.451, 0.200], coil_transform);
let voltmeter = ctx.create_drawable("shader_shaded", null, [0.6, 0.6, 0.6], voltmeter_transform);
let voltmeter_screen = ctx.create_drawable("shader_basic", null, [0.9, 0.9, 0.9], voltmeter_transform);
let voltmeter_arrow = ctx.create_drawable("shader_shaded", null, [0.1, 0.1, 0.1], mat4_mat4_mul(
    mat4_mat4_mul(
        rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(0))),
        translate_3d([0, 0.3, 4]),
    ),
    voltmeter_transform,
)
);

let magnet_north = ctx.create_drawable("shader_shaded",
    create_box(0.75, 0.75, 0.75), red, translate_3d([-0.375, magnet_y_pos, 0]));
let magnet_south = ctx.create_drawable("shader_shaded",
    create_box(0.75, 0.75, 0.75), blue, translate_3d([0.375, magnet_y_pos, 0]));
let magnet_pos_average = [];
let magnet_pos = 0;

let show_magnetic_field = false;

document.getElementById("show-field-checkbox").checked = show_magnetic_field;
document.getElementById("show-field-checkbox").addEventListener("change", function(e){
    show_magnetic_field = this.checked;
});
document.getElementById("magnet-input").value = magnet_pos;
let previous_magnet_pos = 0;
document.getElementById("magnet-input").addEventListener("input", function(e){
    magnet_pos = parseFloat(e.target.value);

    let diff = clamp((previous_magnet_pos-magnet_pos)*15.0, -2.2, 2.2);
    if(magnet_pos_average.length < 10){
        magnet_pos_average.push(diff);
    }
    else{
        magnet_pos_average.push(diff);
        magnet_pos_average.shift();
    }
    previous_magnet_pos = magnet_pos;
    magnet_south.transform = translate_3d([0.375+magnet_pos*2, magnet_y_pos, 0]);
    magnet_north.transform = translate_3d([-0.375+magnet_pos*2, magnet_y_pos, 0]);

    for(let line of magnetic_field_drawables){
        line.transform = translate_3d([magnet_pos*2, 0, 0]);
    }
});

let induction_current = 0;

const obj_data_induction = "v 8.874247 -2.092837 3.577393;v -10.235274 -1.304870 -2.631685;v -9.795976 3.024380 -3.058079;v -9.356676 4.287177 1.104799;v -8.917377 0.450646 3.155470;v -8.478078 -2.309092 -0.207278;v -8.038778 0.450644 -3.570027;v -7.599479 4.287176 -1.519358;v -7.160179 3.024381 2.643522;v -6.720881 -1.304868 2.217130;v -6.281581 -1.731265 -2.112120;v -5.842281 2.431613 -3.374919;v -5.402982 4.482285 0.461611;v -4.963683 1.119539 3.221349;v -4.524384 -2.243211 0.461615;v -4.085084 -0.192544 -3.374918;v -3.645785 3.970336 -2.112123;v -3.206486 3.543943 2.217127;v -2.767187 -0.785307 2.643522;v -2.327887 -2.048103 -1.519357;v -1.888587 1.788429 -3.570028;v -1.449288 4.548166 -0.207285;v -1.009989 1.788435 3.155468;v -0.570689 -2.048101 1.104805;v -0.131390 -0.785312 -3.058076;v 0.307909 3.543939 -2.631688;v 0.747209 3.970339 1.697561;v 1.186508 -0.192538 2.960362;v 1.625807 -2.243212 -0.876167;v 2.065106 1.119533 -3.635907;v 2.504406 4.482285 -0.876175;v 2.943705 2.431619 2.960359;v 3.383004 -1.731262 1.697567;v 3.822303 -1.304872 -2.631683;v 4.261602 3.024378 -3.058080;v 4.700903 4.287177 1.104798;v 5.140201 0.450646 3.155470;v 5.579501 -2.309092 -0.207277;v 6.018800 0.450643 -3.570026;v 6.458100 4.287176 -1.519359;v 6.897397 3.024381 2.643521;v 7.336697 -1.304869 2.217128;v 7.775996 -1.731264 -2.112123;v 8.215296 2.431616 -3.374918;v 8.654597 4.482287 0.461614;v 8.874247 -1.606756 3.217989;v 8.874247 -2.260017 5.228883;v 8.874247 -2.260017 4.291711;v 8.874247 -2.241779 4.136689;v -10.290187 -1.669110 -2.186896;v -10.345099 -1.948174 -1.677368;v -10.400012 -2.140230 -1.121703;v -10.454925 -2.243446 -0.538503;v -10.509837 -2.255991 0.053626;v 8.874247 -1.822308 3.267349;v -10.509837 -2.255991 5.208072;v -9.850887 2.517079 -3.328547;v -9.905800 1.962898 -3.502845;v -9.960712 1.380441 -3.582806;v -10.015625 0.788312 -3.570262;v -10.070538 0.205112 -3.467046;v -10.125450 -0.350553 -3.274989;v -10.180363 -0.860082 -2.995925;v -9.411589 4.453477 0.554480;v -9.466501 4.516311 -0.023056;v -9.521413 4.481104 -0.609921;v -9.576325 4.353282 -1.188226;v -9.631238 4.138274 -1.740082;v -9.686151 3.841502 -2.247602;v -9.741063 3.468396 -2.692897;v -8.972289 1.022835 3.211213;v -9.027202 1.601532 3.160167;v -9.082114 2.170252 3.011145;v -9.137027 2.712508 2.772958;v -9.191938 3.211814 2.454418;v -9.246851 3.651685 2.064337;v -9.301764 4.015635 1.611526;v -8.532990 -2.252135 0.364792;v -8.587902 -2.089172 0.922411;v -8.642815 -1.832062 1.451130;v -8.697727 -1.492662 1.936499;v -8.752640 -1.082833 2.364067;v -8.807551 -0.614433 2.719386;v -8.862464 -0.099320 2.988003;v -8.093691 -0.099322 -3.402560;v -8.148603 -0.614434 -3.133942;v -8.203515 -1.082834 -2.778624;v -8.258428 -1.492663 -2.351055;v -8.313340 -1.832062 -1.865686;v -8.368253 -2.089173 -1.336967;v -8.423165 -2.252136 -0.779347;v -7.654391 4.015634 -2.026085;v -7.709304 3.651684 -2.478895;v -7.764216 3.211812 -2.868976;v -7.819129 2.712506 -3.187516;v -7.874041 2.170250 -3.425703;v -7.928953 1.601530 -3.574725;v -7.983866 1.022833 -3.625770;v -7.215092 3.468396 2.278340;v -7.270004 3.841502 1.833045;v -7.324917 4.138273 1.325524;v -7.379829 4.353282 0.773667;v -7.434742 4.481103 0.195362;v -7.489654 4.516311 -0.391502;v -7.544566 4.453476 -0.969039;v -6.775792 -0.860080 2.581370;v -6.830705 -0.350551 2.860434;v -6.885617 0.205114 3.052490;v -6.940530 0.788313 3.155706;v -6.995442 1.380442 3.168249;v -7.050355 1.962899 3.088288;v -7.105268 2.517079 2.913989;v -6.336493 -2.001733 -1.604818;v -6.391406 -2.176030 -1.050638;v -6.446318 -2.255991 -0.468181;v -6.501230 -2.243446 0.123949;v -6.556143 -2.140230 0.707148;v -6.611055 -1.948173 1.262814;v -6.665968 -1.669108 1.772342;v -5.897194 1.881294 -3.541219;v -5.952106 1.303758 -3.604053;v -6.007019 0.716893 -3.568846;v -6.061932 0.138588 -3.441024;v -6.116843 -0.413268 -3.226014;v -6.171756 -0.920788 -2.929242;v -6.226668 -1.366083 -2.556136;v -5.457894 4.538028 -0.110578;v -5.512807 4.486982 -0.689275;v -5.567719 4.337960 -1.257995;v -5.622632 4.099772 -1.800251;v -5.677545 3.781232 -2.299557;v -5.732456 3.391151 -2.739428;v -5.787369 2.938341 -3.103377;v -5.018595 1.691608 3.164393;v -5.073507 2.249227 3.001430;v -5.128420 2.777946 2.744319;v -5.183332 3.263315 2.404920;v -5.238245 3.690884 1.995090;v -5.293158 4.046201 1.526690;v -5.348070 4.314818 1.011577;v -4.579296 -2.075744 1.011581;v -4.634209 -1.807126 1.526693;v -4.689120 -1.451807 1.995093;v -4.744033 -1.024239 2.404922;v -4.798945 -0.538870 2.744321;v -4.853858 -0.010150 3.001431;v -4.908771 0.547469 3.164393;v -4.139997 -0.699271 -3.103375;v -4.194909 -1.152081 -2.739425;v -4.249822 -1.542161 -2.299554;v -4.304734 -1.860701 -1.800247;v -4.359646 -2.098888 -1.257991;v -4.414558 -2.247910 -0.689271;v -4.469471 -2.298955 -0.110574;v -3.700697 3.605154 -2.556139;v -3.755610 3.159858 -2.929244;v -3.810522 2.652338 -3.226016;v -3.865434 2.100481 -3.441025;v -3.920347 1.522177 -3.568846;v -3.975259 0.935312 -3.604053;v -4.030171 0.357776 -3.541219;v -3.261398 3.908184 1.772339;v -3.316310 4.187247 1.262810;v -3.371223 4.379304 0.707144;v -3.426135 4.482520 0.123945;v -3.481047 4.495063 -0.468184;v -3.535960 4.415102 -1.050641;v -3.590872 4.240804 -1.604822;v -2.822098 -0.278005 2.913989;v -2.877011 0.276176 3.088287;v -2.931923 0.858633 3.168248;v -2.986836 1.450762 3.155704;v -3.041748 2.033961 3.052488;v -3.096661 2.589627 2.860432;v -3.151573 3.099155 2.581367;v -2.382799 -2.214404 -0.969038;v -2.437712 -2.277237 -0.391502;v -2.492624 -2.242031 0.195363;v -2.547536 -2.114209 0.773668;v -2.602449 -1.899200 1.325524;v -2.657361 -1.602428 1.833044;v -2.712274 -1.229322 2.278340;v -1.943500 1.216240 -3.625771;v -1.998412 0.637543 -3.574726;v -2.053325 0.068823 -3.425703;v -2.108237 -0.473433 -3.187516;v -2.163149 -0.972740 -2.868976;v -2.218062 -1.412611 -2.478895;v -2.272974 -1.776561 -2.026085;v -1.504200 4.491210 -0.779354;v -1.559113 4.328247 -1.336973;v -1.614025 4.071136 -1.865691;v -1.668938 3.731737 -2.351060;v -1.723850 3.321907 -2.778627;v -1.778763 2.853507 -3.133945;v -1.833675 2.338395 -3.402562;v -1.064901 2.338400 2.988000;v -1.119813 2.853512 2.719382;v -1.174726 3.321911 2.364063;v -1.229638 3.731740 1.936494;v -1.284551 4.071138 1.451124;v -1.339463 4.328248 0.922404;v -1.394376 4.491210 0.364785;v -0.625602 -1.776557 1.611532;v -0.680514 -1.412607 2.064342;v -0.735427 -0.972736 2.454422;v -0.790339 -0.473428 2.772961;v -0.845251 0.068828 3.011147;v -0.900164 0.637548 3.160168;v -0.955076 1.216246 3.211213;v -0.186302 -1.229326 -2.692894;v -0.241215 -1.602431 -2.247597;v -0.296127 -1.899202 -1.740077;v -0.351040 -2.114211 -1.188220;v -0.405952 -2.242031 -0.609915;v -0.460865 -2.277237 -0.023050;v -0.515777 -2.214402 0.554486;v 0.252997 3.099150 -2.995928;v 0.198085 2.589622 -3.274992;v 0.143172 2.033956 -3.467047;v 0.088260 1.450757 -3.570262;v 0.033347 0.858627 -3.582805;v -0.021565 0.276170 -3.502843;v -0.076478 -0.278010 -3.328544;v 0.692296 4.240806 1.190259;v 0.637384 4.415104 0.636078;v 0.582471 4.495064 0.053621;v 0.527559 4.482520 -0.538509;v 0.472647 4.379302 -1.121707;v 0.417734 4.187245 -1.677373;v 0.362822 3.908180 -2.186901;v 1.131596 0.357781 3.126663;v 1.076683 0.935317 3.189496;v 1.021771 1.522182 3.154288;v 0.966858 2.100487 3.026466;v 0.911946 2.652343 2.811455;v 0.857033 3.159863 2.514684;v 0.802121 3.605158 2.141577;v 1.570895 -2.298955 -0.303978;v 1.515983 -2.247909 0.274719;v 1.461070 -2.098886 0.843439;v 1.406157 -1.860698 1.385695;v 1.351245 -1.542158 1.885001;v 1.296333 -1.152076 2.324872;v 1.241421 -0.699266 2.688821;v 2.010194 0.547463 -3.578950;v 1.955282 -0.010156 -3.415987;v 1.900370 -0.538875 -3.158875;v 1.845457 -1.024243 -2.819476;v 1.790545 -1.451811 -2.409646;v 1.735632 -1.807128 -1.941245;v 1.680720 -2.075746 -1.426133;v 2.449493 4.314816 -1.426140;v 2.394581 4.046198 -1.941252;v 2.339669 3.690879 -2.409652;v 2.284757 3.263310 -2.819481;v 2.229844 2.777941 -3.158879;v 2.174932 2.249222 -3.415989;v 2.120019 1.691602 -3.578951;v 2.888793 2.938346 2.688817;v 2.833880 3.391155 2.324867;v 2.778968 3.781236 1.884995;v 2.724056 4.099775 1.385688;v 2.669144 4.337961 0.843432;v 2.614231 4.486983 0.274712;v 2.559319 4.538028 -0.303986;v 3.328093 -1.366080 2.141582;v 3.273180 -0.920784 2.514688;v 3.218267 -0.413263 2.811459;v 3.163355 0.138593 3.026468;v 3.108443 0.716899 3.154289;v 3.053530 1.303763 3.189495;v 2.998618 1.881299 3.126661;v 3.767392 -1.669112 -2.186894;v 3.712480 -1.948175 -1.677366;v 3.657567 -2.140232 -1.121700;v 3.602654 -2.243447 -0.538501;v 3.547742 -2.255990 0.053629;v 3.492829 -2.176028 0.636086;v 3.437917 -2.001729 1.190266;v 4.206691 2.517076 -3.328547;v 4.151778 1.962896 -3.502845;v 4.096867 1.380439 -3.582806;v 4.041954 0.788309 -3.570261;v 3.987041 0.205110 -3.467045;v 3.932129 -0.350555 -3.274988;v 3.877216 -0.860084 -2.995923;v 4.645990 4.453477 0.554479;v 4.591078 4.516311 -0.023057;v 4.536165 4.481103 -0.609922;v 4.481253 4.353282 -1.188227;v 4.426341 4.138271 -1.740083;v 4.371428 3.841500 -2.247603;v 4.316516 3.468394 -2.692898;v 5.085290 1.022835 3.211213;v 5.030377 1.601532 3.160167;v 4.975465 2.170252 3.011145;v 4.920552 2.712508 2.772957;v 4.865640 3.211815 2.454417;v 4.810728 3.651686 2.064336;v 4.755816 4.015635 1.611526;v 5.524590 -2.252135 0.364792;v 5.469677 -2.089172 0.922412;v 5.414764 -1.832061 1.451131;v 5.359852 -1.492662 1.936500;v 5.304939 -1.082832 2.364068;v 5.250027 -0.614432 2.719386;v 5.195114 -0.099319 2.988003;v 5.963888 -0.099323 -3.402559;v 5.908976 -0.614435 -3.133941;v 5.854064 -1.082835 -2.778623;v 5.799151 -1.492664 -2.351054;v 5.744239 -1.832062 -1.865685;v 5.689326 -2.089173 -1.336966;v 5.634414 -2.252136 -0.779347;v 6.403188 4.015634 -2.026086;v 6.348275 3.651683 -2.478896;v 6.293363 3.211812 -2.868976;v 6.238450 2.712505 -3.187516;v 6.183538 2.170249 -3.425703;v 6.128626 1.601529 -3.574725;v 6.073713 1.022832 -3.625770;v 6.842487 3.468396 2.278339;v 6.787575 3.841502 1.833043;v 6.732662 4.138273 1.325523;v 6.677750 4.353282 0.773666;v 6.622837 4.481103 0.195361;v 6.567925 4.516311 -0.391503;v 6.513013 4.453476 -0.969039;v 7.281787 -0.860081 2.581368;v 7.226874 -0.350552 2.860432;v 7.171962 0.205113 3.052488;v 7.117049 0.788312 3.155704;v 7.062137 1.380442 3.168248;v 7.007224 1.962899 3.088287;v 6.952312 2.517079 2.913988;v 7.721087 -2.001731 -1.604821;v 7.666174 -2.176029 -1.050640;v 7.611261 -2.255991 -0.468183;v 7.556349 -2.243446 0.123946;v 7.501436 -2.140230 0.707145;v 7.446524 -1.948174 1.262811;v 7.391611 -1.669110 1.772339;v 8.160385 1.881296 -3.541219;v 8.105473 1.303760 -3.604053;v 8.050561 0.716895 -3.568846;v 7.995648 0.138591 -3.441024;v 7.940736 -0.413266 -3.226015;v 7.885823 -0.920786 -2.929244;v 7.830911 -1.366081 -2.556138;v 8.599685 4.538030 -0.110575;v 8.544772 4.486984 -0.689272;v 8.489860 4.337961 -1.257992;v 8.434947 4.099774 -1.800248;v 8.380035 3.781234 -2.299555;v 8.325123 3.391153 -2.739426;v 8.270210 2.938343 -3.103376;v 8.874247 -1.138170 3.217989;v 8.874247 1.204760 3.217989;v 8.874247 2.133131 3.046443;v 8.874247 3.021138 2.602439;v 8.819334 3.690889 2.061392;v 8.764422 4.046206 1.546336;v 8.709510 4.314822 1.014035;v 1.120614 -2.258407 7.094903;v -2.756203 -2.257601 7.090740;v -10.509837 -2.255991 5.571713;v -8.999136 -2.256304 7.084038;v -10.394841 -2.256014 6.149957;v -10.067363 -2.256082 6.640416;v -9.577256 -2.256184 6.968421;v 8.874247 -2.260017 5.804452;v 7.575473 -2.259748 7.101832;v 8.775386 -2.259997 6.301365;v 8.493846 -2.259938 6.722415;v 8.072494 -2.259851 7.003502;l 47 48;l 48 49;l 1 49;l 2 50;l 50 51;l 51 52;l 52 53;l 53 54;l 55 46;l 54 56;l 1 55;l 3 57;l 57 58;l 58 59;l 59 60;l 60 61;l 61 62;l 62 63;l 63 2;l 4 64;l 64 65;l 65 66;l 66 67;l 67 68;l 68 69;l 69 70;l 70 3;l 5 71;l 71 72;l 72 73;l 73 74;l 74 75;l 75 76;l 76 77;l 77 4;l 6 78;l 78 79;l 79 80;l 80 81;l 81 82;l 82 83;l 83 84;l 84 5;l 7 85;l 85 86;l 86 87;l 87 88;l 88 89;l 89 90;l 90 91;l 91 6;l 8 92;l 92 93;l 93 94;l 94 95;l 95 96;l 96 97;l 97 98;l 98 7;l 9 99;l 99 100;l 100 101;l 101 102;l 102 103;l 103 104;l 104 105;l 105 8;l 10 106;l 106 107;l 107 108;l 108 109;l 109 110;l 110 111;l 111 112;l 112 9;l 11 113;l 113 114;l 114 115;l 115 116;l 116 117;l 117 118;l 118 119;l 119 10;l 12 120;l 120 121;l 121 122;l 122 123;l 123 124;l 124 125;l 125 126;l 126 11;l 13 127;l 127 128;l 128 129;l 129 130;l 130 131;l 131 132;l 132 133;l 133 12;l 14 134;l 134 135;l 135 136;l 136 137;l 137 138;l 138 139;l 139 140;l 140 13;l 15 141;l 141 142;l 142 143;l 143 144;l 144 145;l 145 146;l 146 147;l 147 14;l 16 148;l 148 149;l 149 150;l 150 151;l 151 152;l 152 153;l 153 154;l 154 15;l 17 155;l 155 156;l 156 157;l 157 158;l 158 159;l 159 160;l 160 161;l 161 16;l 18 162;l 162 163;l 163 164;l 164 165;l 165 166;l 166 167;l 167 168;l 168 17;l 19 169;l 169 170;l 170 171;l 171 172;l 172 173;l 173 174;l 174 175;l 175 18;l 20 176;l 176 177;l 177 178;l 178 179;l 179 180;l 180 181;l 181 182;l 182 19;l 21 183;l 183 184;l 184 185;l 185 186;l 186 187;l 187 188;l 188 189;l 189 20;l 22 190;l 190 191;l 191 192;l 192 193;l 193 194;l 194 195;l 195 196;l 196 21;l 23 197;l 197 198;l 198 199;l 199 200;l 200 201;l 201 202;l 202 203;l 203 22;l 24 204;l 204 205;l 205 206;l 206 207;l 207 208;l 208 209;l 209 210;l 210 23;l 25 211;l 211 212;l 212 213;l 213 214;l 214 215;l 215 216;l 216 217;l 217 24;l 26 218;l 218 219;l 219 220;l 220 221;l 221 222;l 222 223;l 223 224;l 224 25;l 27 225;l 225 226;l 226 227;l 227 228;l 228 229;l 229 230;l 230 231;l 231 26;l 28 232;l 232 233;l 233 234;l 234 235;l 235 236;l 236 237;l 237 238;l 238 27;l 29 239;l 239 240;l 240 241;l 241 242;l 242 243;l 243 244;l 244 245;l 245 28;l 30 246;l 246 247;l 247 248;l 248 249;l 249 250;l 250 251;l 251 252;l 252 29;l 31 253;l 253 254;l 254 255;l 255 256;l 256 257;l 257 258;l 258 259;l 259 30;l 32 260;l 260 261;l 261 262;l 262 263;l 263 264;l 264 265;l 265 266;l 266 31;l 33 267;l 267 268;l 268 269;l 269 270;l 270 271;l 271 272;l 272 273;l 273 32;l 34 274;l 274 275;l 275 276;l 276 277;l 277 278;l 278 279;l 279 280;l 280 33;l 35 281;l 281 282;l 282 283;l 283 284;l 284 285;l 285 286;l 286 287;l 287 34;l 36 288;l 288 289;l 289 290;l 290 291;l 291 292;l 292 293;l 293 294;l 294 35;l 37 295;l 295 296;l 296 297;l 297 298;l 298 299;l 299 300;l 300 301;l 301 36;l 38 302;l 302 303;l 303 304;l 304 305;l 305 306;l 306 307;l 307 308;l 308 37;l 39 309;l 309 310;l 310 311;l 311 312;l 312 313;l 313 314;l 314 315;l 315 38;l 40 316;l 316 317;l 317 318;l 318 319;l 319 320;l 320 321;l 321 322;l 322 39;l 41 323;l 323 324;l 324 325;l 325 326;l 326 327;l 327 328;l 328 329;l 329 40;l 42 330;l 330 331;l 331 332;l 332 333;l 333 334;l 334 335;l 335 336;l 336 41;l 43 337;l 337 338;l 338 339;l 339 340;l 340 341;l 341 342;l 342 343;l 343 42;l 44 344;l 344 345;l 345 346;l 346 347;l 347 348;l 348 349;l 349 350;l 350 43;l 45 351;l 351 352;l 352 353;l 353 354;l 354 355;l 355 356;l 356 357;l 357 44;l 46 358;l 358 359;l 359 360;l 360 361;l 361 362;l 362 363;l 363 364;l 364 45;l 367 369;l 369 370;l 370 371;l 371 368;l 367 56;l 368 366;l 372 374;l 374 375;l 375 376;l 376 373;l 372 47;l 373 365;"
const obj_data_ampere = "v -4.064858 -0.623939 -1.747920;v -3.802358 1.702685 -1.125862;v -3.539858 1.578478 1.279279;v -3.277359 -0.799848 1.658363;v -3.014859 -1.665618 -0.588986;v -2.752359 0.352331 -1.903528;v -2.489859 2.058072 -0.203358;v -2.227359 0.750139 1.818880;v -1.964859 -1.500030 0.960466;v -1.702359 -1.128731 -1.419086;v -1.439859 1.275992 -1.551162;v -1.177359 1.905658 0.773415;v -0.914860 -0.236967 1.873096;v -0.652359 -1.758500 0.006262;v -0.389859 -0.249213 -1.870489;v -0.127359 1.900561 -0.784852;v 0.135140 1.286119 1.543794;v 0.397640 -1.119417 1.427457;v 0.660141 -1.506280 -0.949616;v 0.922640 0.738223 -1.822735;v 1.185140 2.059362 0.190902;v 1.447640 0.364780 1.902198;v 1.710140 -1.661724 0.600889;v 1.972640 -0.810676 -1.652079;v 2.235140 1.570078 -1.288566;v 2.497640 1.710020 1.115711;v 2.760139 -0.612487 1.752979;v 3.022640 -1.719171 -0.386035;v 3.285140 0.142675 -1.913667;v 3.547639 2.024355 -0.410528;v 3.810140 0.945758 1.742785;v 4.107615 3.884153 0.026855;v 4.165188 3.154890 0.053427;v -4.068366 -0.072110 0.229083;v -4.056664 -0.674667 0.144613;v -4.097671 -0.900421 -1.590619;v -4.130484 -1.146115 -1.383571;v -4.145332 -1.361563 -1.135797;v -4.137169 -1.578740 -0.812671;v -4.107116 -1.364662 -0.221267;v -4.089249 -1.557248 -0.543778;v -4.075033 -1.139771 -0.007472;v -3.835171 1.491286 -1.363551;v -3.867983 1.237637 -1.560774;v -3.900796 0.951517 -1.714916;v -3.933609 0.642702 -1.823363;v -3.966421 0.320972 -1.883502;v -3.999233 -0.003897 -1.892717;v -4.032046 -0.322127 -1.848394;v -3.572671 1.766965 1.023040;v -3.605484 1.907077 0.733899;v -3.638296 1.998295 0.421963;v -3.671108 2.040096 0.097340;v -3.703921 2.031957 -0.229861;v -3.736733 1.973357 -0.549534;v -3.769546 1.863773 -0.851570;v -3.310171 -0.509991 1.789392;v -3.342983 -0.198020 1.866259;v -3.375796 0.126070 1.890558;v -3.408608 0.452284 1.863881;v -3.441421 0.770627 1.787822;v -3.474233 1.071104 1.663973;v -3.507046 1.343719 1.493928;v -3.047672 -1.733452 -0.278206;v -3.080484 -1.743707 0.042932;v -3.113297 -1.700023 0.364982;v -3.146108 -1.606037 0.678500;v -3.178921 -1.465388 0.974042;v -3.211733 -1.281714 1.242163;v -3.244546 -1.058655 1.473418;v -2.785172 0.034238 -1.905195;v -2.817984 -0.282002 -1.848389;v -2.850797 -0.587908 -1.738634;v -2.883609 -0.875001 -1.581455;v -2.916422 -1.134798 -1.382376;v -2.949234 -1.358821 -1.146922;v -2.982047 -1.538588 -0.880617;v -2.522672 1.993500 -0.514832;v -2.555484 1.872120 -0.812324;v -2.588297 1.701102 -1.088688;v -2.621109 1.487614 -1.336781;v -2.653922 1.238825 -1.549456;v -2.686734 0.961901 -1.719569;v -2.719547 0.664014 -1.839975;v -2.260172 1.041354 1.690897;v -2.292984 1.307069 1.510259;v -2.325797 1.541789 1.285468;v -2.358609 1.740017 1.025020;v -2.391422 1.896255 0.737415;v -2.424233 2.005009 0.431152;v -2.457046 2.060780 0.114728;v -1.997672 -1.314240 1.218667;v -2.030484 -1.082256 1.440969;v -2.063297 -0.813536 1.623764;v -2.096109 -0.517535 1.763445;v -2.128922 -0.203711 1.856405;v -2.161734 0.118481 1.899036;v -2.194547 0.439583 1.887730;v -1.735172 -1.342610 -1.183626;v -1.767984 -1.511762 -0.910456;v -1.800797 -1.634627 -0.609576;v -1.833609 -1.709645 -0.290986;v -1.866422 -1.735254 0.035313;v -1.899234 -1.709895 0.359322;v -1.932047 -1.632007 0.671040;v -1.472672 1.001174 -1.711352;v -1.505484 0.698781 -1.819947;v -1.538297 0.378918 -1.877501;v -1.571109 0.051692 -1.884569;v -1.603922 -0.272793 -1.841707;v -1.636734 -0.584428 -1.749469;v -1.669547 -0.873110 -1.608410;v -1.210172 2.005144 0.471276;v -1.242984 2.048425 0.152903;v -1.275797 2.038147 -0.171934;v -1.308609 1.976957 -0.493466;v -1.341422 1.867499 -0.801924;v -1.374234 1.712422 -1.087539;v -1.407047 1.514371 -1.340541;v -0.947672 0.079262 1.907521;v -0.980484 0.399671 1.883592;v -1.013297 0.715256 1.805933;v -1.046109 1.017012 1.679163;v -1.078922 1.295935 1.507905;v -1.111734 1.543020 1.296780;v -1.144547 1.749262 1.050410;v -0.685172 -1.726356 0.322731;v -0.717984 -1.636267 0.631143;v -0.750797 -1.494627 0.923654;v -0.783609 -1.307830 1.192419;v -0.816422 -1.082272 1.429590;v -0.849235 -0.824346 1.627324;v -0.882047 -0.540446 1.777774;v -0.422672 -0.552062 -1.773184;v -0.455484 -0.834972 -1.620879;v -0.488297 -1.091599 -1.421461;v -0.521109 -1.315601 -1.182819;v -0.553922 -1.500634 -0.912838;v -0.586734 -1.640357 -0.619406;v -0.619547 -1.728427 -0.310410;v -0.160172 1.742356 -1.060817;v -0.192985 1.534506 -1.305833;v -0.225797 1.286045 -1.515337;v -0.258609 1.006008 -1.684766;v -0.291422 0.703428 -1.809558;v -0.324234 0.387342 -1.885151;v -0.357047 0.066783 -1.906982;v 0.102328 1.523116 1.331618;v 0.069515 1.719507 1.077326;v 0.036703 1.872712 0.790703;v 0.003891 1.980149 0.481535;v -0.028922 2.039233 0.159610;v -0.061734 2.047385 -0.165287;v -0.094547 2.002022 -0.483370;v 0.364828 -0.862562 1.615104;v 0.332015 -0.572964 1.754271;v 0.299203 -0.260731 1.844467;v 0.266391 0.064027 1.885205;v 0.233578 0.391200 1.875996;v 0.200766 0.710679 1.816350;v 0.167953 1.012356 1.705779;v 0.627328 -1.636360 -0.659332;v 0.594515 -1.712206 -0.347111;v 0.561703 -1.735444 -0.022944;v 0.528891 -1.707700 0.303181;v 0.496078 -1.630599 0.621274;v 0.463265 -1.505768 0.921344;v 0.430453 -1.334832 1.193401;v 0.889828 0.427223 -1.889552;v 0.857015 0.106054 -1.898756;v 0.824203 -0.215852 -1.854018;v 0.791390 -0.529061 -1.759007;v 0.758577 -0.824141 -1.617392;v 0.725765 -1.091659 -1.432842;v 0.692953 -1.322183 -1.209027;v 1.152328 2.059988 -0.127195;v 1.119515 2.002147 -0.443247;v 1.086703 1.891392 -0.748793;v 1.053891 1.733274 -1.035369;v 1.021077 1.533347 -1.294514;v 0.988265 1.297161 -1.517765;v 0.955452 1.030269 -1.696659;v 1.414828 0.676042 1.836607;v 1.382015 0.973135 1.714254;v 1.349203 1.248939 1.542333;v 1.316391 1.496332 1.328034;v 1.283577 1.708192 1.078550;v 1.250765 1.877398 0.801071;v 1.217953 1.996828 0.502792;v 1.677328 -1.532789 0.891683;v 1.644515 -1.351283 1.156806;v 1.611702 -1.125725 1.390789;v 1.578890 -0.864631 1.588164;v 1.546077 -0.576516 1.743460;v 1.513265 -0.269899 1.851211;v 1.480453 0.046706 1.905946;v 1.939827 -1.068267 -1.465445;v 1.907015 -1.289809 -1.232735;v 1.874203 -1.471724 -0.963417;v 1.841391 -1.610436 -0.666961;v 1.808578 -1.702369 -0.352834;v 1.775765 -1.743946 -0.030505;v 1.742953 -1.731590 0.290559;v 2.202328 1.333920 -1.501673;v 2.169515 1.060197 -1.669931;v 2.136703 0.758917 -1.791811;v 2.103890 0.440084 -1.865786;v 2.071078 0.113702 -1.890328;v 2.038265 -0.210221 -1.863909;v 2.005453 -0.521682 -1.785002;v 2.464828 1.869310 0.840371;v 2.432015 1.976915 0.537624;v 2.399203 2.033422 0.217575;v 2.366391 2.039420 -0.109673;v 2.333577 1.995496 -0.434015;v 2.300765 1.902239 -0.745347;v 2.267952 1.760237 -1.033565;v 2.727327 -0.310024 1.851476;v 2.694515 0.008489 1.893716;v 2.661702 0.333291 1.882375;v 2.628890 0.654622 1.820133;v 2.596077 0.962720 1.709667;v 2.563264 1.247827 1.553656;v 2.530453 1.500180 1.354778;v 2.989827 -1.752561 -0.069695;v 2.957015 -1.727585 0.250634;v 2.924202 -1.648893 0.565963;v 2.891389 -1.521138 0.867302;v 2.858577 -1.348968 1.145663;v 2.825765 -1.137036 1.392055;v 2.792953 -0.889992 1.597491;v 3.252327 -0.173687 -1.880488;v 3.219515 -0.481803 -1.789390;v 3.186703 -0.773849 -1.646794;v 3.153890 -1.042001 -1.459120;v 3.121078 -1.278433 -1.232786;v 3.088265 -1.475322 -0.974214;v 3.055453 -1.624843 -0.689824;v 3.514827 1.926060 -0.713057;v 3.482015 1.772830 -0.995466;v 3.449202 1.572573 -1.251440;v 3.416389 1.333199 -1.474660;v 3.383578 1.062614 -1.658810;v 3.350765 0.768726 -1.797572;v 3.317953 0.459444 -1.884630;v 3.777327 1.221205 1.583679;v 3.744514 1.465539 1.375028;v 3.711703 1.674228 1.125883;v 3.678889 1.842741 0.845293;v 3.646077 1.966542 0.542308;v 3.613265 2.041100 0.225976;v 3.580452 2.061882 -0.094652;v 4.053365 -1.139431 1.575508;v 4.023201 -0.982631 1.741170;v 3.996162 -0.776618 1.840657;v 3.961405 -0.411476 1.895671;v 3.910705 -0.054661 1.902758;v 3.875765 0.326677 1.891636;v 3.842953 0.644610 1.845232;v 4.194970 2.279263 0.092534;v 4.203652 1.341066 0.162088;v 4.212111 0.529851 0.231732;v 4.212111 -0.144405 0.337084;v 4.212111 -0.576350 0.484578;v 4.197384 -0.849543 0.715716;v 4.166975 -1.076131 0.959297;v 4.112030 -1.170471 1.296645;v 4.034626 4.070587 0.005268;v 3.862804 4.199657 0.016753;v 3.620622 4.302435 0.033507;v 3.346077 4.340679 0.014332;v 1.497915 4.340679 0.019639;v -4.085525 0.945865 0.195541;v -4.096606 2.045566 0.146714;v -4.124323 3.298025 0.121170;v -4.064400 3.643697 0.117363;v -3.903869 3.934877 0.091202;v -3.595232 4.185833 0.044171;v -3.271019 4.328493 0.056377;v -1.283800 4.398129 0.042687;l 35 34;l 42 35;l 1 36;l 36 37;l 37 38;l 38 39;l 41 40;l 39 41;l 40 42;l 2 43;l 43 44;l 44 45;l 45 46;l 46 47;l 47 48;l 48 49;l 49 1;l 3 50;l 50 51;l 51 52;l 52 53;l 53 54;l 54 55;l 55 56;l 56 2;l 4 57;l 57 58;l 58 59;l 59 60;l 60 61;l 61 62;l 62 63;l 63 3;l 5 64;l 64 65;l 65 66;l 66 67;l 67 68;l 68 69;l 69 70;l 70 4;l 6 71;l 71 72;l 72 73;l 73 74;l 74 75;l 75 76;l 76 77;l 77 5;l 7 78;l 78 79;l 79 80;l 80 81;l 81 82;l 82 83;l 83 84;l 84 6;l 8 85;l 85 86;l 86 87;l 87 88;l 88 89;l 89 90;l 90 91;l 91 7;l 9 92;l 92 93;l 93 94;l 94 95;l 95 96;l 96 97;l 97 98;l 98 8;l 10 99;l 99 100;l 100 101;l 101 102;l 102 103;l 103 104;l 104 105;l 105 9;l 11 106;l 106 107;l 107 108;l 108 109;l 109 110;l 110 111;l 111 112;l 112 10;l 12 113;l 113 114;l 114 115;l 115 116;l 116 117;l 117 118;l 118 119;l 119 11;l 13 120;l 120 121;l 121 122;l 122 123;l 123 124;l 124 125;l 125 126;l 126 12;l 14 127;l 127 128;l 128 129;l 129 130;l 130 131;l 131 132;l 132 133;l 133 13;l 15 134;l 134 135;l 135 136;l 136 137;l 137 138;l 138 139;l 139 140;l 140 14;l 16 141;l 141 142;l 142 143;l 143 144;l 144 145;l 145 146;l 146 147;l 147 15;l 17 148;l 148 149;l 149 150;l 150 151;l 151 152;l 152 153;l 153 154;l 154 16;l 18 155;l 155 156;l 156 157;l 157 158;l 158 159;l 159 160;l 160 161;l 161 17;l 19 162;l 162 163;l 163 164;l 164 165;l 165 166;l 166 167;l 167 168;l 168 18;l 20 169;l 169 170;l 170 171;l 171 172;l 172 173;l 173 174;l 174 175;l 175 19;l 21 176;l 176 177;l 177 178;l 178 179;l 179 180;l 180 181;l 181 182;l 182 20;l 22 183;l 183 184;l 184 185;l 185 186;l 186 187;l 187 188;l 188 189;l 189 21;l 23 190;l 190 191;l 191 192;l 192 193;l 193 194;l 194 195;l 195 196;l 196 22;l 24 197;l 197 198;l 198 199;l 199 200;l 200 201;l 201 202;l 202 203;l 203 23;l 25 204;l 204 205;l 205 206;l 206 207;l 207 208;l 208 209;l 209 210;l 210 24;l 26 211;l 211 212;l 212 213;l 213 214;l 214 215;l 215 216;l 216 217;l 217 25;l 27 218;l 218 219;l 219 220;l 220 221;l 221 222;l 222 223;l 223 224;l 224 26;l 28 225;l 225 226;l 226 227;l 227 228;l 228 229;l 229 230;l 230 231;l 231 27;l 29 232;l 232 233;l 233 234;l 234 235;l 235 236;l 236 237;l 237 238;l 238 28;l 30 239;l 239 240;l 240 241;l 241 242;l 242 243;l 243 244;l 244 245;l 245 29;l 31 246;l 246 247;l 247 248;l 248 249;l 249 250;l 250 251;l 251 252;l 252 30;l 32 33;l 253 254;l 254 255;l 255 256;l 256 257;l 257 258;l 258 259;l 259 31;l 260 261;l 262 263;l 263 264;l 264 265;l 265 266;l 266 267;l 267 253;l 33 260;l 261 262;l 268 32;l 269 268;l 270 269;l 271 270;l 272 271;l 34 273;l 273 274;l 274 275;l 275 276;l 276 277;l 277 278;l 278 279;l 279 280;"

function parse_path(obj_data) {
    const lines = obj_data.split(';');
    const vertices = [];
    const adj = {};
    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'v') {
            vertices.push(parts.slice(1).map(parseFloat));
        }
    });
    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'l') {
            const a = parseInt(parts[1], 10);
            const b = parseInt(parts[2], 10);
            adj[a] = adj[a] || [];
            adj[b] = adj[b] || [];
            adj[a].push(b);
            adj[b].push(a);
        }
    });
    const ends = Object.keys(adj).map(k => parseInt(k, 10)).filter(k => adj[k].length === 1);
    const ordered_idx = [];
    let current = ends[0];
    let prev = null;
    while (true) {
        ordered_idx.push(current);
        const nexts = adj[current].filter(n => n !== prev);
        if (nexts.length === 0) break;
        prev = current;
        current = nexts[0];
    }
    return ordered_idx.map(i => vertices[i - 1]);
}

function get_position_along_path(path, t) {
    const segment_lengths = [];
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        segment_lengths.push(Math.hypot(dx, dy, dz));
    }
    const total_length = segment_lengths.reduce((sum, l) => sum + l, 0);
    const cum_lengths = [0];
    for (let l of segment_lengths) {
        cum_lengths.push(cum_lengths[cum_lengths.length - 1] + l);
    }
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const target = t * total_length;
    let segment = 0;
    while (segment < segment_lengths.length && cum_lengths[segment + 1] < target) {
        segment++;
    }
    const seg_start = cum_lengths[segment];
    const seg_len = segment_lengths[segment];
    const local_t = seg_len === 0 ? 0 : (target - seg_start) / seg_len;
    const p0 = path[segment];
    const p1 = path[segment + 1];
    return [
        (1 - local_t) * p0[0] + local_t * p1[0],
        (1 - local_t) * p0[1] + local_t * p1[1],
        (1 - local_t) * p0[2] + local_t * p1[2]
    ];
}

const path_induction = parse_path(obj_data_induction);

let num_electrons_induction = 200;
let coil_electrons_induction = [];
for(let i = 0; i < num_electrons_induction; i++){
    let coil_electron = ctx.create_drawable("shader_basic", create_uv_sphere(0.1, 32, 32, true), blue, mat4_identity(),
    [
        { name: "position_attrib", size: 3 },
        { name: "normal_attrib", size: 3 },
        { name: "texcoord_attrib", size: 2 },
    ]);
    let t = i/num_electrons_induction;
    coil_electrons_induction.push([coil_electron, t]);
}
// scene_induction setup

// scene_ampere setup
let ampere_transform = mat4_mat4_mul(
    translate_3d([0, 0, 0]),
    scale_3d([0.4, 0.4, 0.4]),
);

let coil_ampere = ctx.create_drawable("shader_shaded", null, [0.722, 0.451, 0.200], ampere_transform);
let battery1 = ctx.create_drawable("shader_shaded", null, [0.3, 0.3, 0.3], mat4_identity());
let battery2 = ctx.create_drawable("shader_shaded", null, [0.841, 0.500, 0.189], mat4_identity());
let battery_cap1 = ctx.create_drawable("shader_shaded", null, [0.7, 0.7, 0.7], mat4_mat4_mul(
    mat4_mat4_mul(
        scale_3d([0.5, 0.5, 0.5]),
        translate_3d([1.8, 2.2, 0]),
    ),
    ampere_transform,
));
let battery_cap2 = ctx.create_drawable("shader_shaded", null, [0.7, 0.7, 0.7], mat4_mat4_mul(
    mat4_mat4_mul(
        scale_3d([0.5, 0.5, 0.5]),
        translate_3d([-1, 2.2, 0]),
    ),
    ampere_transform,
));
let magnet_transform = mat4_mat4_mul(
    mat4_mat4_mul(
        translate_3d([4.5, 0, -1]),
        rotate_3d(axis_angle_to_quat(vec3_normalize([1, 0, 0]), rad(90))),
    ),
    scale_3d([0.7, 0.7, 0.7]),
);
let magnet = ctx.create_drawable("shader_shaded", null, [0.4, 0.4, 0.4], magnet_transform);
let magnet_arrow1 = ctx.create_drawable("shader_shaded", null, [0.9, 0.9, 0.9], mat4_identity());
let magnet_arrow2 = ctx.create_drawable("shader_shaded", null, red, mat4_identity());

function update_ampere_scene(voltage, average){
    battery1.transform = mat4_mat4_mul(
        rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(voltage < 0 ? 180 : 0))),
        ampere_transform);
    battery2.transform = mat4_mat4_mul(
            mat4_mat4_mul(ampere_transform, translate_3d([0.644, 0, 0])),
            rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(voltage < 0 ? 180 : 0))),
        );

    let magnet_rotation = lerp(0, 180, remap_value(average, -1, 1, 1, 0));
    magnet_arrow1.transform = mat4_mat4_mul(
        mat4_mat4_mul(
            translate_3d([0, 0, -0.2]),
            rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(magnet_rotation+90))),
        ), magnet_transform);
    magnet_arrow2.transform = mat4_mat4_mul(
        mat4_mat4_mul(
            translate_3d([0, 0, -0.2]),
            rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(magnet_rotation-90))),
        ), magnet_transform);
}

let ampere_voltage = 0;
let average_ampere_voltage = [0];
document.getElementById("voltage-input-ampere").value = ampere_voltage;
document.getElementById("voltage-input-ampere").addEventListener("input", function(e){
    let new_voltage = parseFloat(e.target.value);
    ampere_voltage = new_voltage;
    document.getElementById("voltage-display").innerHTML = Math.floor(new_voltage*10);
});

const path_ampere = parse_path(obj_data_ampere);

let num_electrons_ampere = 130;
let coil_electrons_ampere = [];
for(let i = 0; i < num_electrons_ampere; i++){
    let coil_electron = ctx.create_drawable("shader_basic", create_uv_sphere(0.1, 32, 32, true), blue, mat4_identity(),
    [
        { name: "position_attrib", size: 3 },
        { name: "normal_attrib", size: 3 },
        { name: "texcoord_attrib", size: 2 },
    ]);
    let t = i/num_electrons_ampere;
    coil_electrons_ampere.push([coil_electron, t]);
}
// scene_ampere setup
// scene_apple_lights
let flashlight_transform = mat4_mat4_mul(
    scale_3d([0.4, 0.4, 0.4]),
    mat4_mat4_mul(
        translate_3d([0, 0, -3.7]),
        mat4_mat4_mul(
            rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(70))),
            rotate_3d(axis_angle_to_quat(vec3_normalize([1, 0, 0]), rad(80))),
        ),
    ),
);

let apple_transform_flashlight = mat4_mat4_mul(
    scale_3d([1, 1, 1]),
    translate_3d([0, 0, 0]),
);

let flashlight_color = [1, 1, 1];
let flashlight_inside = ctx.create_drawable("shader_shaded", null, flashlight_color, flashlight_transform);
let flashlight_light = ctx.create_drawable("shader_flashlight", null, flashlight_color, flashlight_transform);
flashlight_light.alpha = 1.0;


function create_small_graph(graph_position, data){
    let axis_color = [0.4, 0.4, 0.4];
    let graph_x_axis = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [0.7, 0, 0], [0.02, 0.04, 0.04]), axis_color, translate_3d(graph_position));
    let graph_y_axis = ctx.create_drawable("shader_basic", create_arrow([0.01, 0, 0], [0.01, 0.5, 0], [0.02, 0.04, 0.04]), axis_color, translate_3d(graph_position));

    let graph_drawable_line = ctx.create_drawable("shader_spd", null, [1, 1, 1], translate_3d(graph_position));

    return {
        "graph_x_axis": graph_x_axis,
        "graph_y_axis": graph_y_axis,
        "graph_drawable_line": graph_drawable_line,
    };
}

function update_small_graph(graph, data){
    let graph_drawable_points = [];
    let graph_width = 0.6;
    let graph_height = 0.28;
    let graph_height_min = 0.05;
    for(let i = 0; i < data.length; i++){
        let x = i/data.length * graph_width + 0.02;
        graph_drawable_points.push([x, data[i]*graph_height + graph_height_min, 0]);
    }
    ctx.update_drawable_mesh(graph["graph_drawable_line"], create_line(graph_drawable_points, 0.017, false));
}

let ui_camera_small_graph = {
    fov: 50, z_near: 0.1, z_far: 1000,
    position: [0, 0, 0], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {rotation: [0, 0, 0], pivot: [0, 0, 0], zoom: 3.0}
};
update_camera_orbit(ui_camera_small_graph);
update_camera_projection_matrix(ui_camera_small_graph, ctx.scenes["scene_apple_lights"].width/ctx.scenes["scene_apple_lights"].height);
function rgb_to_spectral_distribution(r, g, b) {
    const num_points = 80;
    const min_wavelength = 420;
    const max_wavelength = 740;
    const distribution = [];

    let r_spread = 30;
    let g_spread = 15;
    let b_spread = 10;

    for (let i = 0; i < num_points; i++) {
        const wavelength = min_wavelength + (i / (num_points - 1)) * (max_wavelength - min_wavelength);

        const red_contribution = r * Math.exp(-0.5 * Math.pow((wavelength - 660) / r_spread, 2));
        const green_contribution = g * Math.exp(-0.5 * Math.pow((wavelength - 530) / g_spread, 2));
        const blue_contribution = b * Math.exp(-0.5 * Math.pow((wavelength - 460) / b_spread, 2));

        let value = red_contribution + green_contribution + blue_contribution;
        value = Math.min(1, value);
        distribution.push(value);
    }
    return distribution;
}

function combine_spectra(light_spectrum, reflectance_spectrum){
    const result_spectrum = [];

    for (let i = 0; i < light_spectrum.length; i++) {
        result_spectrum.push(light_spectrum[i] * reflectance_spectrum[i]);
    }

    return result_spectrum;
}

let small_graph_spd_data = [];
let small_graph_spd = create_small_graph([1.6, -0.2+0.9, 0], small_graph_spd_data);
let small_graph_apple_data = [];
let small_graph_apple = create_small_graph([1.6, -0.20, 0], small_graph_apple_data);
let small_graph_result_data = [];
let small_graph_result = create_small_graph([1.6, -0.2-0.9, 0], small_graph_result_data);

let small_graph_spd_metamers_data = [];
let small_graph_spd_metamers = create_small_graph([1.6, -0.2+0.9, 0], small_graph_spd_metamers_data);
let small_graph_banana_data = [];
let small_graph_banana = create_small_graph([1.6, -0.20, 0], small_graph_banana_data);
let small_graph_apple_metamers_data = [];
let small_graph_apple_metamers = create_small_graph([1.6, -0.20, 0], small_graph_apple_metamers_data);

let small_graph_result_metamers_banana_data = [];
let small_graph_result_metamers_banana = create_small_graph([1.6, -0.2-0.9, 0], small_graph_result_metamers_banana_data);

let small_graph_result_metamers_apple_data = [];
let small_graph_result_metamers_apple = create_small_graph([1.6, -0.2-0.9, 0], small_graph_result_metamers_apple_data);

let show_apple_graph = true;

document.getElementById("display-banana-curve").addEventListener("click", function(e){
    document.getElementById("display-banana-curve").classList.add("active");
    document.getElementById("display-apple-curve").classList.remove("active");
    show_apple_graph = false;
});
document.getElementById("display-apple-curve").addEventListener("click", function(e){
    document.getElementById("display-apple-curve").classList.add("active");
    document.getElementById("display-banana-curve").classList.remove("active");
    show_apple_graph = true;
});

let multiply_sign = ctx.create_drawable("shader_basic", create_plus_sign([0, 0, 0], 0.2, 0.025), [0.4, 0.4, 0.4],
    mat4_mat4_mul(
        rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(-45))),
        translate_3d([1.6+0.35, 0.45, 0]),
    )
);
let equal_sign_width = 0.11;
let equal_sign_start_left = 1.6+0.35;
let equal_sign_height = 0.045;
let equal_sign_start_top = -0.45;
let equal_sign1 = ctx.create_drawable("shader_basic", create_line([
    [equal_sign_start_left-equal_sign_width, equal_sign_start_top+equal_sign_height, 0],
    [equal_sign_start_left+equal_sign_width, equal_sign_start_top+equal_sign_height, 0]
], 0.025), [0.4, 0.4, 0.4],
    mat4_identity()
);
let equal_sign2 = ctx.create_drawable("shader_basic", create_line([
    [equal_sign_start_left-equal_sign_width, equal_sign_start_top-equal_sign_height, 0],
    [equal_sign_start_left+equal_sign_width, equal_sign_start_top-equal_sign_height, 0]
], 0.025), [0.4, 0.4, 0.4],
    mat4_identity()
);
["r", "g", "b"].forEach(function(component, i){
    const elem = document.getElementById("light-"+component+"-input");
    elem.value = flashlight_color[i];
    elem.addEventListener("input", e => {
        flashlight_light.alpha = Math.max(flashlight_color[0], Math.max(flashlight_color[1], flashlight_color[2]));
        flashlight_color[i] = parseFloat(e.target.value);
        flashlight_light.color = flashlight_inside.color = flashlight_color;
        update_small_graphs();
    });
});

function ease_out_cubic(x) {
    return 1 - Math.pow(1 - x, 3);
}

function update_small_graphs(){
    small_graph_spd_data = rgb_to_spectral_distribution(flashlight_color[0], flashlight_color[1], flashlight_color[2]);
    update_small_graph(small_graph_spd, small_graph_spd_data);

    small_graph_apple_data = rgb_to_spectral_distribution(1, 0, 0);
    update_small_graph(small_graph_apple, small_graph_apple_data);

    small_graph_result_data = combine_spectra(small_graph_spd_data, small_graph_apple_data);
    update_small_graph(small_graph_result, small_graph_result_data);
}

function update_small_graphs_metamers(){
    small_graph_spd_metamers_data = rgb_to_spectral_distribution(flashlight_color_m[0], flashlight_color_m[1], flashlight_color_m[2]);
    update_small_graph(small_graph_spd_metamers, small_graph_spd_metamers_data);

    small_graph_banana_data = rgb_to_spectral_distribution(0.88, 0.8, 0);
    update_small_graph(small_graph_banana, small_graph_banana_data);

    small_graph_apple_metamers_data = rgb_to_spectral_distribution(1, 0, 0);
    update_small_graph(small_graph_apple_metamers, small_graph_apple_metamers_data);

    small_graph_result_metamers_banana_data = combine_spectra(small_graph_spd_metamers_data, small_graph_banana_data);
    update_small_graph(small_graph_result_metamers_banana, small_graph_result_metamers_banana_data);

    small_graph_result_metamers_apple_data = combine_spectra(small_graph_spd_metamers_data, small_graph_apple_metamers_data);
    update_small_graph(small_graph_result_metamers_apple, small_graph_result_metamers_apple_data);
}

function animate_sliders(flashlight_color, flashlight_light, target_color, id){
    const current_color = [...flashlight_color];

    const duration = 100;
    const fps = 200;
    const steps = duration / (1000 / fps);
    let step = 0;

    const increment_r = target_color[0] - current_color[0];
    const increment_g = target_color[1] - current_color[1];
    const increment_b = target_color[2] - current_color[2];

    if (window.slider_interval) {
        clearInterval(window.slider_interval);
    }

    window.slider_interval = setInterval(() => {
        if(id == "-m"){
            update_small_graphs_metamers();
        }
        else{
            update_small_graphs();
        }

        if (step >= steps) {
            flashlight_color = [...target_color];
            document.getElementById("light-r-input"+id).value = target_color[0];
            document.getElementById("light-g-input"+id).value = target_color[1];
            document.getElementById("light-b-input"+id).value = target_color[2];

            update_slider_background(document.getElementById("light-r-input"+id));
            update_slider_background(document.getElementById("light-g-input"+id));
            update_slider_background(document.getElementById("light-b-input"+id));

            flashlight_light.alpha = Math.max(flashlight_color[0], Math.max(flashlight_color[1], flashlight_color[2]));
            flashlight_light.color = flashlight_color;
            if(id == "-m"){
                flashlight_inside_m.color = flashlight_color;
            } else {
                flashlight_inside.color = flashlight_color;
            }

            clearInterval(window.slider_interval);
            return;
        }

        const progress = step / steps;
        const eased_progress = ease_out_cubic(progress);

        flashlight_color[0] = current_color[0] + (increment_r * eased_progress);
        flashlight_color[1] = current_color[1] + (increment_g * eased_progress);
        flashlight_color[2] = current_color[2] + (increment_b * eased_progress);

        document.getElementById("light-r-input"+id).value = flashlight_color[0];
        document.getElementById("light-g-input"+id).value = flashlight_color[1];
        document.getElementById("light-b-input"+id).value = flashlight_color[2];

        update_slider_background(document.getElementById("light-r-input"+id));
        update_slider_background(document.getElementById("light-g-input"+id));
        update_slider_background(document.getElementById("light-b-input"+id));

        flashlight_light.alpha = Math.max(flashlight_color[0], Math.max(flashlight_color[1], flashlight_color[2]));
        flashlight_light.color = flashlight_color;
        if(id == "-m"){
            flashlight_inside_m.color = flashlight_color;
        } else {
            flashlight_inside.color = flashlight_color;
        }

        step++;
    }, 1000 / fps);
}

update_small_graphs();
// scene_apple_lights
// scene_metamers
let flashlight = ctx.create_drawable("shader_shaded", null, [0.3, 0.3, 0.3], flashlight_transform);
let flashlight_color_m = [1, 1, 1];
let flashlight_inside_m = ctx.create_drawable("shader_shaded", null, flashlight_color_m, flashlight_transform);
let flashlight_light_m = ctx.create_drawable("shader_flashlight", null, flashlight_color_m, flashlight_transform);
flashlight_light_m.alpha = 1.0;

["r", "g", "b"].forEach(function(component, i){
    const elem = document.getElementById("light-"+component+"-input-m");
    elem.value = flashlight_color_m[i];
    elem.addEventListener("input", e => {
        flashlight_light_m.alpha = Math.max(flashlight_color_m[0], Math.max(flashlight_color_m[1], flashlight_color_m[2]));
        flashlight_color_m[i] = parseFloat(e.target.value);
        flashlight_light_m.color = flashlight_inside_m.color = flashlight_color_m;
        update_small_graphs_metamers();
    });
});

let apple_transform_metamers = mat4_mat4_mul(
    scale_3d([0.8, 0.8, 0.8]),
    translate_3d([-1.2, 0, 0]),
);

let banana_transform =
mat4_mat4_mul(
    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(-40))),
    mat4_mat4_mul(
        scale_3d([0.4, 0.4, 0.4]),
        translate_3d([1.2, -0.5, 0])
    ),
);
let banana = ctx.create_drawable("shader_apple", null, [0, 0, 0], banana_transform);
let banana_head = ctx.create_drawable("shader_apple", null, [0, 0, 0], banana_transform);

update_small_graphs_metamers();

const color_map = {
    "white": [1, 1, 1],
    "red": [1, 0, 0],
    "green": [0, 1, 0]
};

function setup_buttons(button_class, other_button_class, color_var, light_var, suffix = "") {
    const buttons = document.querySelectorAll(button_class);
    buttons.forEach(button => {
        button.addEventListener("click", () => {
            const color = button.getAttribute("data-color");
            const target_color = color_map[color];

            animate_sliders(color_var, light_var, target_color, suffix);

            buttons.forEach(b => b.classList.remove("active"));
            button.classList.add("active");

            const other_buttons = document.querySelectorAll(other_button_class);
            other_buttons.forEach(b => b.classList.remove("active"));

            for(let other_button of other_buttons) {
                if(other_button.getAttribute("data-color") === color) {
                    other_button.classList.add("active");
                }
            }
        });
    });
}

setup_buttons(".button-light", ".button-light-inline", flashlight_color, flashlight_light);
setup_buttons(".button-light-inline", ".button-light", flashlight_color, flashlight_light);
setup_buttons(".button-light-m", ".button-light-inline-m", flashlight_color_m, flashlight_light_m, "-m");
setup_buttons(".button-light-inline-m", ".button-light-m", flashlight_color_m, flashlight_light_m, "-m");
// scene_metamers
// scene_apple
let apple_transform = mat4_identity();
let apple_color = [1, 0, 0];
let apple_stem_color = [0.467, 0.318, 0.251];
let apple_leaf_color = [0.380, 0.627, 0.149];
let apple = ctx.create_drawable("shader_apple", null, [0, 0, 0], apple_transform);
let apple_stem = ctx.create_drawable("shader_apple", null, [0, 0, 0], apple_transform);
let apple_leaf = ctx.create_drawable("shader_apple", null, [0, 0, 0], apple_transform);

let wave_param_apple = {
    num_points: 500,
    width: 3.7,
    amplitude: 0.1,
    frequency: 6,
    thickness: 0.02,
    z_range: 0,
    time: 0,
};
let wave_param_2_apple = {
    num_points: 500,
    width: 3.7,
    amplitude: 0.1,
    frequency: 6,
    thickness: 0.02,
    z_range: 0,
    time: 0,
};
let wave_blue_3d = {vertex_buffer: null, shader: "shader_basic"};
let wave_violet_3d = {vertex_buffer: null, shader: "shader_basic"};
let wave_red_3d = {vertex_buffer: null, shader: "shader_basic"};
let wave_red_2_3d = {vertex_buffer: null, shader: "shader_basic"};
let wave_green_3d = {vertex_buffer: null, shader: "shader_basic"};
let wave_1_pos = [0.6, 0.0, 0];
wave_red_2_3d.transform =
mat4_mat4_mul(
    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(-20))),
    translate_3d([0.5, 0.3, 0]),
    );

wave_blue_3d.transform =
mat4_mat4_mul(
mat4_mat4_mul(
    translate_3d([0.0, 0.08, 0.0]),
    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(45))),
    ),
    translate_3d(vec3_add(wave_1_pos, [0.0, 0.0, 0.0])),
    );
wave_violet_3d.transform =
mat4_mat4_mul(
mat4_mat4_mul(
    translate_3d([0.0, 0.1, 0.0]),
    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(45))),
    ),
    translate_3d(vec3_add(wave_1_pos, [0.0, 0.0, 0.0])),
    );
wave_green_3d.transform =
mat4_mat4_mul(
mat4_mat4_mul(
    translate_3d([0.0, 0.04, 0.0]),
    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(45))),
    ),
    translate_3d(vec3_add(wave_1_pos, [0.0, 0.0, 0.0])),
    );
wave_red_3d.transform =
mat4_mat4_mul(
mat4_mat4_mul(
    translate_3d([0.0, 0.00, 0.0]),
    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(45))),
    ),
    translate_3d(vec3_add(wave_1_pos, [0.0, 0.0, 0.0])),
    );
// scene_apple
// scene_bulb_graphs
let voltage_graph_position = [-2.4, -0.5, 0];
let scene_bulb_graph_x_axis = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [1.4, 0, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(voltage_graph_position));
let scene_bulb_graph_y_axis = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [0, 1, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(voltage_graph_position));
let graph_num_points = 200;
let voltage_graph = [];
for(let i = 0; i < graph_num_points; i++){
    voltage_graph.push(0.1);
}
let voltage_graph_drawable_points = [];
for(let i = 0; i < voltage_graph.length; i++){
    let x = i * 1.3 / (graph_num_points-1);
    voltage_graph_drawable_points.push([x, voltage_graph[i], 0]);
}
let voltage_graph_drawable = ctx.create_drawable("shader_basic", null, blue, translate_3d(voltage_graph_position));
ctx.update_drawable_mesh(voltage_graph_drawable, create_line(voltage_graph_drawable_points, 0.03, false));

let current_voltage = 0;
let current_current = 0;
let current_brightness = 0;
let current_temperature = 20;
document.getElementById("voltage-input").value = 0;
document.getElementById("voltage-input").addEventListener("input", (e) => {
    current_voltage = parseFloat(e.target.value);
});
ctx.text_buffers["graph_voltage_y_axis"] = {text: "Voltage", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(voltage_graph_position, [-0.22, 1.05, 0])))};
ctx.text_buffers["graph_voltage_y_max"] = {text: "220 V", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(voltage_graph_position, [-0.35, 0.75, 0])))};
ctx.text_buffers["graph_voltage_y_min"] = {text: "0 V", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(voltage_graph_position, [-0.21, 0.1, 0])))};

let temperature_graph_position = [-0.5, -0.5, 0];
let scene_bulb_graph_x_axis_temperature = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [1.4, 0, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(temperature_graph_position));
let scene_bulb_graph_y_axis_temperature = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [0, 1, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(temperature_graph_position));
let temperature_graph = [];
for(let i = 0; i < graph_num_points; i++){
    temperature_graph.push(0.1);
}
let temperature_graph_drawable_points = [];
for(let i = 0; i < temperature_graph.length; i++){
    let x = i * 1.3 / (graph_num_points-1);
    temperature_graph_drawable_points.push([x, temperature_graph[i], 0]);
}
let temperature_graph_drawable = ctx.create_drawable("shader_basic", null, red, translate_3d(temperature_graph_position));
ctx.update_drawable_mesh(temperature_graph_drawable, create_line(temperature_graph_drawable_points, 0.03, false));

ctx.text_buffers["graph_temperature_y_axis"] = {text: "Temperature", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(temperature_graph_position, [-0.22, 1.05, 0])))};
ctx.text_buffers["graph_temperature_y_max"] = {text: "2500°C", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(temperature_graph_position, [-0.45, 0.75, 0])))};
ctx.text_buffers["graph_temperature_y_min"] = {text: "20°C", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(temperature_graph_position, [-0.32, 0.1, 0])))};
let current_graph_position = [1.4, -0.5, 0];
let scene_bulb_graph_x_axis_current = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [1.4, 0, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(current_graph_position));
let scene_bulb_graph_y_axis_current = ctx.create_drawable("shader_basic", create_arrow([0, 0, 0], [0, 1, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(current_graph_position));
let current_graph = [];
for(let i = 0; i < graph_num_points; i++){
    current_graph.push(0.1);
}
let current_graph_drawable_points = [];
for(let i = 0; i < current_graph.length; i++){
    let x = i * 1.3 / (graph_num_points-1);
    current_graph_drawable_points.push([x, current_graph[i], 0]);
}
let current_graph_drawable = ctx.create_drawable("shader_basic", null, green, translate_3d(current_graph_position));
ctx.update_drawable_mesh(current_graph_drawable, create_line(current_graph_drawable_points, 0.03, false));

ctx.text_buffers["graph_current_y_axis"] = {text: "Current", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(current_graph_position, [-0.22, 1.05, 0])))};
ctx.text_buffers["graph_current_y_max"] = {text: "2 A", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(current_graph_position, [-0.24, 0.75, 0])))};
ctx.text_buffers["graph_current_y_min"] = {text: "0 A", color: [0, 0, 0], transform: mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_add(current_graph_position, [-0.24, 0.1, 0])))};
// scene_bulb_graphs
// scene_led
let led_transform =
mat4_mat4_mul(
    translate_3d([0, -2, 0]),
    scale_3d([1.5, 1.5, 1.5])
);
let led_metal = ctx.create_drawable("shader_shaded", null, [0.5, 0.5, 0.5], led_transform);
let led_epoxy_case = ctx.create_drawable("shader_glass", null, [1, 1, 1], led_transform);
let led_reflective_case = ctx.create_drawable("shader_shaded", null, [1, 1, 1], led_transform);


let wire_position = [-0.25, 0.45, 0];
let wire_text_position = [-1.5, 0.5, 0];
let line_wire = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["wire"] = {text: "Wire", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(wire_text_position))};

let semiconductor_position = [0.25, 0, 0];
let semiconductor_text_position = [0.7, 0.1, 0];
let line_semiconductor = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["semiconductor"] = {text: "Semiconductor chip", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(semiconductor_text_position))};

let epoxy_case_position = [0.1, 2, 0];
let epoxy_case_text_position = [1, 1, 0];
let line_epoxy_case = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["epoxy_case"] = {text: "Epoxy case", color: [0, 0, 0], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(epoxy_case_text_position))};

let ui_camera_led = {
    fov: 50, z_near: 0.1, z_far: 1000,
    position: [0, 0, 0], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {rotation: [0, 0, 0], pivot: [0, 0, 0], zoom: 3.0}
};
update_camera_orbit(ui_camera_led);
update_camera_projection_matrix(ui_camera_led, ctx.scenes["scene_led"].width/ctx.scenes["scene_led"].height);
// scene_led
// scene_reflection_3d

let outgoing_light_color = [0.047, 0.608, 0.000];
let incoming_light_color = [1.000, 0.514, 0.000];
let normal_color = [0.784, 0.224, 0.008];

let scene_reflection_3d_arrow_thickness = [0.006, 0.05, 0.017];

let hemisphere = ctx.create_drawable("shader_basic_alpha", create_uv_hemisphere(0.25, 32, 32), [0, 0, 0], mat4_identity(),
[
    { name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
]);
let hemisphere_base = ctx.create_drawable("shader_basic_alpha", create_disk([0, 0, 0], 0.25, 32), [0, 0, 0], mat4_identity());

let outgoing_light_arrow_end = vec3_scale(vec3_normalize([-0.5, 0.5, 0]), 0.4);
let outgoing_light_arrow = ctx.create_drawable("shader_basic", create_arrow_3d([[0, 0, 0], outgoing_light_arrow_end],
    scene_reflection_3d_arrow_thickness[0], 32,
    scene_reflection_3d_arrow_thickness[1],
    scene_reflection_3d_arrow_thickness[2]), outgoing_light_color, mat4_identity());
ctx.text_buffers["outgoing_light"] = {text: "L", color: outgoing_light_color, transform: mat4_identity()};
ctx.text_buffers["outgoing_light_sub"] = {text: "o", color: outgoing_light_color, transform: mat4_identity()};

let incoming_light_arrow_start = vec3_scale(vec3_normalize([0.5, 0.5, 0]), 0.4);
let incoming_light_arrow_end = vec3_add([0, 0, 0], vec3_scale(vec3_normalize(vec3_sub([0.5, 0.5, 0], [0, 0, 0])), 0.05));
let incoming_light_arrow = ctx.create_drawable("shader_basic", create_arrow_3d([incoming_light_arrow_start, incoming_light_arrow_end],
    scene_reflection_3d_arrow_thickness[0], 32,
    scene_reflection_3d_arrow_thickness[1],
    scene_reflection_3d_arrow_thickness[2]), incoming_light_color, mat4_identity());
ctx.text_buffers["incoming_light"] = {text: "L", color: incoming_light_color, transform: mat4_identity()};
ctx.text_buffers["incoming_light_sub"] = {text: "i", color: incoming_light_color, transform: mat4_identity()};

let normal_arrow_end = [0, 0.2, 0];
let normal_arrow = ctx.create_drawable("shader_basic", create_arrow_3d([[0, 0, 0], normal_arrow_end],
    scene_reflection_3d_arrow_thickness[0], 32,
    scene_reflection_3d_arrow_thickness[1],
    scene_reflection_3d_arrow_thickness[2]), normal_color, mat4_identity());
ctx.text_buffers["normal"] = {text: "n", color: normal_color, transform: mat4_identity()};

ctx.text_buffers["hemisphere_omega"] = {text: "Ω", color: [0.4, 0.4, 0.4], transform: mat4_identity()};

let brdf_color = [0.596, 0.643, 1.000];
let brdf_arrows = [];
let brdf_arrow_num = 20;

for(let i = 0; i < brdf_arrow_num; i++){
    let cone_center = vec3_normalize(outgoing_light_arrow_end);
    let cone_angle = Math.PI / 4;
    let z_axis = cone_center;

    let temp = [1, 0, 0];
    if (Math.abs(vec3_dot(z_axis, temp)) > 0.9) {
        temp = [0, 1, 0];
    }
    let x_axis = vec3_normalize(vec3_cross(z_axis, temp));
    let y_axis = vec3_normalize(vec3_cross(z_axis, x_axis));

    let golden_ratio = (1 + Math.sqrt(5)) / 2;
    let phi = 2 * Math.PI * i / golden_ratio;
    let cos_theta = 1 - (1 - Math.cos(cone_angle)) * i / (brdf_arrow_num - 1);
    let theta = Math.acos(cos_theta);

    let cone_direction = [
        Math.sin(theta) * Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta)
    ];

    let direction = [
        cone_direction[0] * x_axis[0] + cone_direction[1] * y_axis[0] + cone_direction[2] * z_axis[0],
        cone_direction[0] * x_axis[1] + cone_direction[1] * y_axis[1] + cone_direction[2] * z_axis[1],
        cone_direction[0] * x_axis[2] + cone_direction[1] * y_axis[2] + cone_direction[2] * z_axis[2]
    ];

    let arrow_end = vec3_scale(direction, 0.14);
    let brdf_arrow_thickness = [0.003, 0.02, 0.01];

    let arrow = ctx.create_drawable("shader_basic", create_arrow_3d([[0, 0, 0], arrow_end],
        brdf_arrow_thickness[0], 32,
        brdf_arrow_thickness[1],
        brdf_arrow_thickness[2]), brdf_color, mat4_identity());
    brdf_arrows.push(arrow);
}

let ui_camera_reflection_3d = {
    fov: 50, z_near: 0.1, z_far: 1000,
    position: [0, 0, 0], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {rotation: [0, 0, 0], pivot: [0, 0, 0], zoom: 3.0}
};
update_camera_orbit(ui_camera_reflection_3d);
update_camera_projection_matrix(ui_camera_reflection_3d, ctx.scenes["scene_reflection_3d"].width/ctx.scenes["scene_reflection_3d"].height);
// scene_reflection_3d
// scene_sun
let sun_surface = ctx.create_drawable("shader_sun_surface", null, [1.000, 0.605, 0.020], mat4_identity());
let sun_cross = ctx.create_drawable("shader_sun_cross", null, [0.826, 0.344, 0.000], mat4_identity());
let sun_core = ctx.create_drawable("shader_basic", create_uv_sphere(0.4, 32, 32, true), [1.000, 0.948, 0.880], mat4_identity(),
[
    { name: "position_attrib", size: 3 },
    { name: "normal_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 },
]);

let core_position = [0, 0, 0, 1];
let core_text_position = [1.72, 0.83, 0];
let line_core = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["sun_core"] = {text: "Core", color: [0.8, 0.8, 0.8], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(core_text_position))};

let radiativezone_position = [0.1, 0.6, 0, 1];
let radiativezone_text_position = [0.8, 1.0, 0];
let line_radiativezone = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["sun_radiativezone"] = {text: "Radiative Zone", color: [0.8, 0.8, 0.8], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(radiativezone_text_position))};

let convectivezone_position = [0, 0.5, 0.75, 1];
let convectivezone_text_position = [-1.5, 1.0, 0];
let line_convectivezone = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["sun_convectivezone"] = {text: "Convective Zone", color: [0.8, 0.8, 0.8], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(convectivezone_text_position))};

let photosphere_position = [...vec3_normalize(vec3_sub([0.2, -0.1, 0.3], [0, 0, 0])), 1];
let photosphere_text_position = [1.5, -0.4, 0];
let line_photosphere = ctx.create_drawable("shader_basic", create_line([], 0.01), [0.8, 0.8, 0.8], translate_3d([0, 0, 0]));
ctx.text_buffers["sun_photosphere"] = {text: "Photosphere", color: [0.8, 0.8, 0.8], transform: mat4_mat4_mul(scale_3d([0.0025, 0.0025, 0.0025]), translate_3d(photosphere_text_position))};

let ui_camera_sun = {
    fov: 50, z_near: 0.1, z_far: 1000,
    position: [0, 0, 0], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {rotation: [0, 0, 0], pivot: [0, 0, 0], zoom: 3.0}
};
update_camera_orbit(ui_camera_sun);
update_camera_projection_matrix(ui_camera_sun, ctx.scenes["scene_sun"].width/ctx.scenes["scene_sun"].height);

function generate_random_photon_walk(){
    const random_points = [[0, 0, 0]];
    let current_position = [0, 0, 0];
    const max_steps = 100;
    const step_size = 0.05;
    const forward_bias = 0.4;
    for (let i = 0; i < max_steps; i++) {
        let theta;

        if (Math.random() < forward_bias) {
            theta = Math.random() * Math.PI * 0.5;
        } else {
            theta = Math.random() * Math.PI * 2;
        }

        const dx = Math.cos(theta) * step_size;
        const dy = Math.sin(theta) * step_size;

        const new_x = current_position[0] + dx;
        const new_y = current_position[1] + dy;

        if (new_x >= 0 && new_y >= 0) {
            current_position = [new_x, new_y, 0];
            random_points.push([...current_position]);
        } else {
            i--;
            continue;
        }

        const distance = Math.sqrt(
            current_position[0] * current_position[0] +
            current_position[1] * current_position[1]
        );

        if (distance > 1) {
            const normalized = [
                current_position[0] / distance,
                current_position[1] / distance,
                0
            ];
            random_points[random_points.length - 1] = normalized;
            break;
        }
    }
    return random_points;
}

const num_rays = 5;
const photon_rays = [];
const photon_walks = [];
const photon_steps = [];
const photon_waits = [];
const ejected_spheres = [];
const sphere_positions = [];
const sphere_velocities = [];
const sphere_active = [];

for (let i = 0; i < num_rays; i++) {
    let line_ray = ctx.create_drawable("shader_basic", create_line_3d([0, 0, 0], 0.01, 16), [1, 1, 1], translate_3d([0, 0, 0]));
    photon_rays.push(line_ray);
    photon_walks.push(generate_random_photon_walk());
    photon_steps.push(1);
    photon_waits.push(0);

    let sphere = ctx.create_drawable("shader_basic", create_uv_sphere(0.02, 16, 16, true), [1, 1, 1], mat4_identity(),
    [
        { name: "position_attrib", size: 3 },
        { name: "normal_attrib", size: 3 },
        { name: "texcoord_attrib", size: 2 },
    ]);
    ejected_spheres.push(sphere);
    sphere_positions.push([0, 0, 0]);
    sphere_velocities.push([0, 0, 0]);
    sphere_active.push(false);
}

// scene_sun
// scene_bulb
let bulb_transform =
mat4_mat4_mul(
    translate_3d([-0.7, 0, 0]),
    scale_3d([1.3, 1.3, 1.3])
);
let bulb = ctx.create_drawable("shader_glass", null, [1, 1, 1], bulb_transform);
let bulb2 = ctx.create_drawable("shader_glass", null, [1, 1, 1], bulb_transform);
let bulb_screw = ctx.create_drawable("shader_shaded", null, [0.8, 0.8, 0.8], bulb_transform);
let bulb_screw_black = ctx.create_drawable("shader_shaded", null, [0.3, 0.3, 0.3], bulb_transform);
let bulb_wire = ctx.create_drawable("shader_shaded", null, [0.2, 0.2, 0.2], bulb_transform);
let bulb_wire_holder = ctx.create_drawable("shader_shaded", null, [0.2, 0.2, 0.2], bulb_transform);
let zoom_circle_pos = [1.4, 0, 0];
let zoom_circle_radius = 0.9;
let zoom_circle = ctx.create_drawable("shader_basic", create_circle_stroke(zoom_circle_pos, zoom_circle_radius, 64, 0.01), [0.4, 0.4, 0.4], translate_3d([0, 0, 0]));
let mask_circle = ctx.create_drawable("shader_basic", create_circle(zoom_circle_pos, zoom_circle_radius, 64), [0, 0, 0], translate_3d([0, 0, 0]));
let zoom_point = [-0.75, 0.44, 0];
let dx = zoom_circle_pos[0] - zoom_point[0];
let dy = zoom_circle_pos[1] - zoom_point[1];
let dist = Math.sqrt(dx*dx + dy*dy);
let angle = Math.acos(zoom_circle_radius/dist);
let base_angle = Math.atan2(dy, dx);
let tangent1_angle = base_angle + angle;
let tangent2_angle = base_angle - angle;
let tangent1_point = [
    zoom_circle_pos[0] - zoom_circle_radius * Math.cos(tangent1_angle),
    zoom_circle_pos[1] - zoom_circle_radius * Math.sin(tangent1_angle),
    zoom_circle_pos[2]
];
let tangent2_point = [
    zoom_circle_pos[0] - zoom_circle_radius * Math.cos(tangent2_angle),
    zoom_circle_pos[1] - zoom_circle_radius * Math.sin(tangent2_angle),
    zoom_circle_pos[2]
];
let zoom_line_1 = ctx.create_drawable("shader_basic", create_line_dashed([tangent1_point, zoom_point], 0.01, 0.03, 0.015), [0.4, 0.4, 0.4], translate_3d([0, 0, 0]));
let zoom_line_2 = ctx.create_drawable("shader_basic", create_line_dashed([tangent2_point, zoom_point], 0.01, 0.03, 0.015), [0.4, 0.4, 0.4], translate_3d([0, 0, 0]));
let ui_camera = {
    fov: 50, z_near: 0.1, z_far: 1000,
    position: [0, 0, 0], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {rotation: [0, 0, 0], pivot: [0, 0, 0], zoom: 3.0}
};
update_camera_orbit(ui_camera);
update_camera_projection_matrix(ui_camera, ctx.scenes["scene_bulb"].width/ctx.scenes["scene_bulb"].height);

function update_particle_pos(particle){
    particle.particle.transform = translate_3d(particle.pos);
    particle.particle_background.transform = translate_3d(particle.pos);
}

function add_particle(scene, pos, particle_size = 0.25, border_size = 0.21, particle_type){
    let particle_background_color;
    if(particle_type == "tungsten"){
        particle_background_color = [0.7, 0.7, 0.7];
    }
    else if(particle_type == "electron"){
        particle_background_color = [0.000, 0.625, 1.000];
    }

    let particle_background = ctx.create_drawable("shader_basic", create_circle([0, 0, 0], particle_size, 32), [0.1, 0.1, 0.1], mat4_identity());
    let particle = ctx.create_drawable("shader_basic", create_circle([0, 0, 0], border_size, 32), particle_background_color, mat4_identity());

    let id = scene.particles.length;

    let text_id = "";
    if(particle_type == "tungsten"){
        text_id = "tungsten_w_"+id;
        ctx.text_buffers["tungsten_w_"+id] = {text: "W", color: [0, 0, 0], transform: mat4_mat4_mul(
            scale_3d([0.0025, 0.0025, 0.0025]),
            translate_3d(vec3_sub(pos, [0.06, 0.04, 0.0])),
        )};
    }
    else if(particle_type == "electron"){
        text_id = "electron_w_"+id;
        ctx.text_buffers["electron_w_"+id] = {text: "e", color: [0, 0, 0], transform: mat4_mat4_mul(
                        scale_3d([0.0025, 0.0025, 0.0025]),
                        translate_3d(vec3_sub(pos, [0.032, 0.03, 0.0])),
                    )};
    }

    scene.particles.push({id: id, particle: particle, particle_background: particle_background, pos: pos, size: particle_size, text_id: text_id});
    update_particle_pos(scene.particles[scene.particles.length-1]);
    return id;
}

let spacing = 0.2;
let start_x = zoom_circle_pos[0] - zoom_circle_radius + spacing;
let start_y = zoom_circle_pos[1] - zoom_circle_radius + spacing;

let tungsten_particles = [];
for(let i = 0; i < 9; i++) {
    for(let j = 0; j < 4; j++) {
        let x = start_x + spacing * i;
        let y = start_y + spacing * j;

        tungsten_particles.push(add_particle(
            ctx.scenes["scene_bulb"],
            [x-0.15, y-0.1, 0.1],
            0.1,
            0.08,
            "tungsten"
        ));
    }
}
let electron_particles = [];
for(let i = 0; i < 9; i++) {
    for(let j = 0; j < 3; j++) {
        let x = start_x - 0.2 + spacing * i + (Math.random() - 0.5) * 0.05;
        let y = start_y + 0.1 + spacing * j + (Math.random() - 0.5) * 0.09;
        electron_particles.push(add_particle(
            ctx.scenes["scene_bulb"],
            [x-0.15, y-0.1, 0.1],
            0.07,
            0.05,
            "electron"
        ));
    }
}

let photon_waves = [];
let photon_wave_param = {
    num_points: 500,
    width: 0.4,
    amplitude: 0.05,
    frequency: 20,
    thickness: 0.013,
    z_range: 0,
    time: 0,
};
let number_photons = 9;
for (let i = 0; i < number_photons; i++) {
    let photon_wave = {vertex_buffer: null, shader: "shader_basic"};
    let random_angle = rad(74 + Math.random() * 20);
    let random_pos;
    let overlap;
    do {
        overlap = false;
        random_pos = [
            zoom_circle_pos[0] + (Math.random() - 0.5) * zoom_circle_radius * 2,
            zoom_circle_pos[1] + (Math.random() - 0.5) * 0.4 - 0.4,
            zoom_circle_pos[2]
        ];
        for (let j = 0; j < photon_waves.length; j++) {
            let dx = random_pos[0] - photon_waves[j].transform[12];
            let dy = random_pos[1] - photon_waves[j].transform[13];
            let distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 0.2) {
                overlap = true;
                break;
            }
        }
    } while (overlap);
    photon_wave.transform = mat4_mat4_mul(
        rotate_3d(axis_angle_to_quat([0, 0, 1], random_angle)),
        translate_3d(random_pos),
    );
    photon_wave.angle = random_angle;
    photon_wave.color = [1.000, 0.885, 0.000];
    ctx.update_wave_3d(photon_wave, photon_wave_param, lines_segments_3d);
    photon_waves.push(photon_wave);
}
// scene_bulb
// scene_spd
function triangulate_points(points) {
    let vertices = [];
    for (let i = 0; i < points.length; i++) {
        vertices.push([...points[i]]);
    }

    let indices = [];
    let remaining_vertices = vertices.length;

    let final_vertices = [];

    function is_convex(prev, current, next) {
        const [x1, y1] = prev;
        const [x2, y2] = current;
        const [x3, y3] = next;

        const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
        return cross < 0;
    }

    function point_in_triangle(p, v0, v1, v2) {
        const [px, py] = p;
        const [x0, y0] = v0;
        const [x1, y1] = v1;
        const [x2, y2] = v2;

        const v0x = x2 - x0;
        const v0y = y2 - y0;
        const v1x = x1 - x0;
        const v1y = y1 - y0;
        const v2x = px - x0;
        const v2y = py - y0;

        const dot00 = v0x * v0x + v0y * v0y;
        const dot01 = v0x * v1x + v0y * v1y;
        const dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y;
        const dot12 = v1x * v2x + v1y * v2y;

        const inv_denom = 1 / (dot00 * dot11 - dot01 * dot01);
        const u = (dot11 * dot02 - dot01 * dot12) * inv_denom;
        const v = (dot00 * dot12 - dot01 * dot02) * inv_denom;

        return (u >= 0) && (v >= 0) && (u + v <= 1);
    }

    function is_ear(i, vertices, indices_left) {
        const prev = vertices[(i - 1 + remaining_vertices) % remaining_vertices];
        const curr = vertices[i];
        const next = vertices[(i + 1) % remaining_vertices];

        if (!is_convex(prev, curr, next)) {
            return false;
        }

        for (let j = 0; j < remaining_vertices; j++) {
            if (j !== i && j !== ((i - 1 + remaining_vertices) % remaining_vertices) &&
                j !== ((i + 1) % remaining_vertices)) {
                const p = vertices[j];
                if (point_in_triangle(p, prev, curr, next)) {
                    return false;
                }
            }
        }
        return true;
    }

    let i = 0;
    let vertex_indices = Array.from({length: vertices.length}, (_, i) => i);

    let infinite_loop = 0;
    while (remaining_vertices > 3) {
        infinite_loop++;
        if(infinite_loop > 1000) break;
        if (is_ear(i, vertices, vertex_indices)) {
            const prev_idx = (i - 1 + remaining_vertices) % remaining_vertices;
            const next_idx = (i + 1) % remaining_vertices;

            indices.push(vertex_indices[next_idx], vertex_indices[i], vertex_indices[prev_idx]);

            vertices.splice(i, 1);
            vertex_indices.splice(i, 1);
            remaining_vertices--;

            if (i >= remaining_vertices) i = 0;
        } else {
            i = (i + 1) % remaining_vertices;
        }
    }

    indices.push(vertex_indices[2], vertex_indices[1], vertex_indices[0]);

    for (let v of points) {
        final_vertices.push(v[0], v[1], v[2], 0, 0, 0);
    }

    return {
        vertices: final_vertices,
        indices: indices
    };
}

let cie_d65 = "300,0.0341;301,0.36014;302,0.68618;303,1.01222;304,1.33826;305,1.6643;306,1.99034;307,2.31638;308,2.64242;309,2.96846;310,3.2945;311,4.98865;312,6.6828;313,8.37695;314,10.0711;315,11.7652;316,13.4594;317,15.1535;318,16.8477;319,18.5418;320,20.236;321,21.9177;322,23.5995;323,25.2812;324,26.963;325,28.6447;326,30.3265;327,32.0082;328,33.69;329,35.3717;330,37.0535;331,37.343;332,37.6326;333,37.9221;334,38.2116;335,38.5011;336,38.7907;337,39.0802;338,39.3697;339,39.6593;340,39.9488;341,40.4451;342,40.9414;343,41.4377;344,41.934;345,42.4302;346,42.9265;347,43.4228;348,43.9191;349,44.4154;350,44.9117;351,45.0844;352,45.257;353,45.4297;354,45.6023;355,45.775;356,45.9477;357,46.1203;358,46.293;359,46.4656;360,46.6383;361,47.1834;362,47.7285;363,48.2735;364,48.8186;365,49.3637;366,49.9088;367,50.4539;368,50.9989;369,51.544;370,52.0891;371,51.8777;372,51.6664;373,51.455;374,51.2437;375,51.0323;376,50.8209;377,50.6096;378,50.3982;379,50.1869;380,49.9755;381,50.4428;382,50.91;383,51.3773;384,51.8446;385,52.3118;386,52.7791;387,53.2464;388,53.7137;389,54.1809;390,54.6482;391,57.4589;392,60.2695;393,63.0802;394,65.8909;395,68.7015;396,71.5122;397,74.3229;398,77.1336;399,79.9442;400,82.7549;401,83.628;402,84.5011;403,85.3742;404,86.2473;405,87.1204;406,87.9936;407,88.8667;408,89.7398;409,90.6129;410,91.486;411,91.6806;412,91.8752;413,92.0697;414,92.2643;415,92.4589;416,92.6535;417,92.8481;418,93.0426;419,93.2372;420,93.4318;421,92.7568;422,92.0819;423,91.4069;424,90.732;425,90.057;426,89.3821;427,88.7071;428,88.0322;429,87.3572;430,86.6823;431,88.5006;432,90.3188;433,92.1371;434,93.9554;435,95.7736;436,97.5919;437,99.4102;438,101.228;439,103.047;440,104.865;441,106.079;442,107.294;443,108.508;444,109.722;445,110.936;446,112.151;447,113.365;448,114.579;449,115.794;450,117.008;451,117.088;452,117.169;453,117.249;454,117.33;455,117.41;456,117.49;457,117.571;458,117.651;459,117.732;460,117.812;461,117.517;462,117.222;463,116.927;464,116.632;465,116.336;466,116.041;467,115.746;468,115.451;469,115.156;470,114.861;471,114.967;472,115.073;473,115.18;474,115.286;475,115.392;476,115.498;477,115.604;478,115.711;479,115.817;480,115.923;481,115.212;482,114.501;483,113.789;484,113.078;485,112.367;486,111.656;487,110.945;488,110.233;489,109.522;490,108.811;491,108.865;492,108.92;493,108.974;494,109.028;495,109.082;496,109.137;497,109.191;498,109.245;499,109.3;500,109.354;501,109.199;502,109.044;503,108.888;504,108.733;505,108.578;506,108.423;507,108.268;508,108.112;509,107.957;510,107.802;511,107.501;512,107.2;513,106.898;514,106.597;515,106.296;516,105.995;517,105.694;518,105.392;519,105.091;520,104.79;521,105.08;522,105.37;523,105.66;524,105.95;525,106.239;526,106.529;527,106.819;528,107.109;529,107.399;530,107.689;531,107.361;532,107.032;533,106.704;534,106.375;535,106.047;536,105.719;537,105.39;538,105.062;539,104.733;540,104.405;541,104.369;542,104.333;543,104.297;544,104.261;545,104.225;546,104.19;547,104.154;548,104.118;549,104.082;550,104.046;551,103.641;552,103.237;553,102.832;554,102.428;555,102.023;556,101.618;557,101.214;558,100.809;559,100.405;560,100;561,99.6334;562,99.2668;563,98.9003;564,98.5337;565,98.1671;566,97.8005;567,97.4339;568,97.0674;569,96.7008;570,96.3342;571,96.2796;572,96.225;573,96.1703;574,96.1157;575,96.0611;576,96.0065;577,95.9519;578,95.8972;579,95.8426;580,95.788;581,95.0778;582,94.3675;583,93.6573;584,92.947;585,92.2368;586,91.5266;587,90.8163;588,90.1061;589,89.3958;590,88.6856;591,88.8177;592,88.9497;593,89.0818;594,89.2138;595,89.3459;596,89.478;597,89.61;598,89.7421;599,89.8741;600,90.0062;601,89.9655;602,89.9248;603,89.8841;604,89.8434;605,89.8026;606,89.7619;607,89.7212;608,89.6805;609,89.6398;610,89.5991;611,89.4091;612,89.219;613,89.029;614,88.8389;615,88.6489;616,88.4589;617,88.2688;618,88.0788;619,87.8887;620,87.6987;621,87.2577;622,86.8167;623,86.3757;624,85.9347;625,85.4936;626,85.0526;627,84.6116;628,84.1706;629,83.7296;630,83.2886;631,83.3297;632,83.3707;633,83.4118;634,83.4528;635,83.4939;636,83.535;637,83.576;638,83.6171;639,83.6581;640,83.6992;641,83.332;642,82.9647;643,82.5975;644,82.2302;645,81.863;646,81.4958;647,81.1285;648,80.7613;649,80.394;650,80.0268;651,80.0456;652,80.0644;653,80.0831;654,80.1019;655,80.1207;656,80.1395;657,80.1583;658,80.177;659,80.1958;660,80.2146;661,80.4209;662,80.6272;663,80.8336;664,81.0399;665,81.2462;666,81.4525;667,81.6588;668,81.8652;669,82.0715;670,82.2778;671,81.8784;672,81.4791;673,81.0797;674,80.6804;675,80.281;676,79.8816;677,79.4823;678,79.0829;679,78.6836;680,78.2842;681,77.4279;682,76.5716;683,75.7153;684,74.859;685,74.0027;686,73.1465;687,72.2902;688,71.4339;689,70.5776;690,69.7213;691,69.9101;692,70.0989;693,70.2876;694,70.4764;695,70.6652;696,70.854;697,71.0428;698,71.2315;699,71.4203;700,71.6091;701,71.8831;702,72.1571;703,72.4311;704,72.7051;705,72.979;706,73.253;707,73.527;708,73.801;709,74.075;710,74.349;711,73.0745;712,71.8;713,70.5255;714,69.251;715,67.9765;716,66.702;717,65.4275;718,64.153;719,62.8785;720,61.604;721,62.4322;722,63.2603;723,64.0885;724,64.9166;725,65.7448;726,66.573;727,67.4011;728,68.2293;729,69.0574;730,69.8856;731,70.4057;732,70.9259;733,71.446;734,71.9662;735,72.4863;736,73.0064;737,73.5266;738,74.0467;739,74.5669;740,75.087;741,73.9376;742,72.7881;743,71.6387;744,70.4893;745,69.3398;746,68.1904;747,67.041;748,65.8916;749,64.7421;750,63.5927;751,61.8752;752,60.1578;753,58.4403;754,56.7229;755,55.0054;756,53.288;757,51.5705;758,49.8531;759,48.1356;760,46.4182;761,48.4569;762,50.4956;763,52.5344;764,54.5731;765,56.6118;766,58.6505;767,60.6892;768,62.728;769,64.7667;770,66.8054;771,66.4631;772,66.1209;773,65.7786;774,65.4364;775,65.0941;776,64.7518;777,64.4096;778,64.0673;779,63.7251;780,63.3828;781,63.4749;782,63.567;783,63.6592;784,63.7513;785,63.8434;786,63.9355;787,64.0276;788,64.1198;789,64.2119;790,64.304;791,63.8188;792,63.3336;793,62.8484;794,62.3632;795,61.8779;796,61.3927;797,60.9075;798,60.4223;799,59.9371;800,59.4519;801,58.7026;802,57.9533;803,57.204;804,56.4547;805,55.7054;806,54.9562;807,54.2069;808,53.4576;809,52.7083;810,51.959;811,52.5072;812,53.0553;813,53.6035;814,54.1516;815,54.6998;816,55.248;817,55.7961;818,56.3443;819,56.8924;820,57.4406;821,57.7278;822,58.015;823,58.3022;824,58.5894;825,58.8765;826,59.1637;827,59.4509;828,59.7381;829,60.0253;830,60.3125";
let cie_a = "300,0.930483;301,0.967643;302,1.00597;303,1.04549;304,1.08623;305,1.12821;306,1.17147;307,1.21602;308,1.26188;309,1.3091;310,1.35769;311,1.40768;312,1.4591;313,1.51198;314,1.56633;315,1.62219;316,1.67959;317,1.73855;318,1.7991;319,1.86127;320,1.92508;321,1.99057;322,2.05776;323,2.12667;324,2.19734;325,2.2698;326,2.34406;327,2.42017;328,2.49814;329,2.57801;330,2.65981;331,2.74355;332,2.82928;333,2.91701;334,3.00678;335,3.09861;336,3.19253;337,3.28857;338,3.38676;339,3.48712;340,3.58968;341,3.69447;342,3.80152;343,3.91085;344,4.0225;345,4.13648;346,4.25282;347,4.37156;348,4.49272;349,4.61631;350,4.74238;351,4.87095;352,5.00204;353,5.13568;354,5.27189;355,5.4107;356,5.55213;357,5.69622;358,5.84298;359,5.99244;360,6.14462;361,6.29955;362,6.45724;363,6.61774;364,6.78105;365,6.9472;366,7.11621;367,7.28811;368,7.46292;369,7.64066;370,7.82135;371,8.00501;372,8.19167;373,8.38134;374,8.57404;375,8.7698;376,8.96864;377,9.17056;378,9.37561;379,9.58378;380,9.7951;381,10.0096;382,10.2273;383,10.4481;384,10.6722;385,10.8996;386,11.1302;387,11.364;388,11.6012;389,11.8416;390,12.0853;391,12.3324;392,12.5828;393,12.8366;394,13.0938;395,13.3543;396,13.6182;397,13.8855;398,14.1563;399,14.4304;400,14.708;401,14.9891;402,15.2736;403,15.5616;404,15.853;405,16.148;406,16.4464;407,16.7484;408,17.0538;409,17.3628;410,17.6753;411,17.9913;412,18.3108;413,18.6339;414,18.9605;415,19.2907;416,19.6244;417,19.9617;418,20.3026;419,20.647;420,20.995;421,21.3465;422,21.7016;423,22.0603;424,22.4225;425,22.7883;426,23.1577;427,23.5307;428,23.9072;429,24.2873;430,24.6709;431,25.0581;432,25.4489;433,25.8432;434,26.2411;435,26.6425;436,27.0475;437,27.456;438,27.8681;439,28.2836;440,28.7027;441,29.1253;442,29.5515;443,29.9811;444,30.4142;445,30.8508;446,31.2909;447,31.7345;448,32.1815;449,32.632;450,33.0859;451,33.5432;452,34.004;453,34.4682;454,34.9358;455,35.4068;456,35.8811;457,36.3588;458,36.8399;459,37.3243;460,37.8121;461,38.3031;462,38.7975;463,39.2951;464,39.796;465,40.3002;466,40.8076;467,41.3182;468,41.832;469,42.3491;470,42.8693;471,43.3926;472,43.9192;473,44.4488;474,44.9816;475,45.5174;476,46.0563;477,46.5983;478,47.1433;479,47.6913;480,48.2423;481,48.7963;482,49.3533;483,49.9132;484,50.476;485,51.0418;486,51.6104;487,52.1818;488,52.7561;489,53.3332;490,53.9132;491,54.4958;492,55.0813;493,55.6694;494,56.2603;495,56.8539;496,57.4501;497,58.0489;498,58.6504;499,59.2545;500,59.8611;501,60.4703;502,61.082;503,61.6962;504,62.3128;505,62.932;506,63.5535;507,64.1775;508,64.8038;509,65.4325;510,66.0635;511,66.6968;512,67.3324;513,67.9702;514,68.6102;515,69.2525;516,69.8969;517,70.5435;518,71.1922;519,71.843;520,72.4959;521,73.1508;522,73.8077;523,74.4666;524,75.1275;525,75.7903;526,76.4551;527,77.1217;528,77.7902;529,78.4605;530,79.1326;531,79.8065;532,80.4821;533,81.1595;534,81.8386;535,82.5193;536,83.2017;537,83.8856;538,84.5712;539,85.2584;540,85.947;541,86.6372;542,87.3288;543,88.0219;544,88.7165;545,89.4124;546,90.1097;547,90.8083;548,91.5082;549,92.2095;550,92.912;551,93.6157;552,94.3206;553,95.0267;554,95.7339;555,96.4423;556,97.1518;557,97.8623;558,98.5739;559,99.2864;560,100;561,100.715;562,101.43;563,102.146;564,102.864;565,103.582;566,104.301;567,105.02;568,105.741;569,106.462;570,107.184;571,107.906;572,108.63;573,109.354;574,110.078;575,110.803;576,111.529;577,112.255;578,112.982;579,113.709;580,114.436;581,115.164;582,115.893;583,116.622;584,117.351;585,118.08;586,118.81;587,119.54;588,120.27;589,121.001;590,121.731;591,122.462;592,123.193;593,123.924;594,124.655;595,125.386;596,126.118;597,126.849;598,127.58;599,128.312;600,129.043;601,129.774;602,130.505;603,131.236;604,131.966;605,132.697;606,133.427;607,134.157;608,134.887;609,135.617;610,136.346;611,137.075;612,137.804;613,138.532;614,139.26;615,139.988;616,140.715;617,141.441;618,142.167;619,142.893;620,143.618;621,144.343;622,145.067;623,145.79;624,146.513;625,147.235;626,147.957;627,148.678;628,149.398;629,150.117;630,150.836;631,151.554;632,152.271;633,152.988;634,153.704;635,154.418;636,155.132;637,155.845;638,156.558;639,157.269;640,157.979;641,158.689;642,159.397;643,160.104;644,160.811;645,161.516;646,162.221;647,162.924;648,163.626;649,164.327;650,165.028;651,165.726;652,166.424;653,167.121;654,167.816;655,168.51;656,169.203;657,169.895;658,170.586;659,171.275;660,171.963;661,172.65;662,173.335;663,174.019;664,174.702;665,175.383;666,176.063;667,176.741;668,177.419;669,178.094;670,178.769;671,179.441;672,180.113;673,180.783;674,181.451;675,182.118;676,182.783;677,183.447;678,184.109;679,184.77;680,185.429;681,186.087;682,186.743;683,187.397;684,188.05;685,188.701;686,189.35;687,189.998;688,190.644;689,191.288;690,191.931;691,192.572;692,193.211;693,193.849;694,194.484;695,195.118;696,195.75;697,196.381;698,197.009;699,197.636;700,198.261;701,198.884;702,199.506;703,200.125;704,200.743;705,201.359;706,201.972;707,202.584;708,203.195;709,203.803;710,204.409;711,205.013;712,205.616;713,206.216;714,206.815;715,207.411;716,208.006;717,208.599;718,209.189;719,209.778;720,210.365;721,210.949;722,211.532;723,212.112;724,212.691;725,213.268;726,213.842;727,214.415;728,214.985;729,215.553;730,216.12;731,216.684;732,217.246;733,217.806;734,218.364;735,218.92;736,219.473;737,220.025;738,220.574;739,221.122;740,221.667;741,222.21;742,222.751;743,223.29;744,223.826;745,224.361;746,224.893;747,225.423;748,225.951;749,226.477;750,227;751,227.522;752,228.041;753,228.558;754,229.073;755,229.585;756,230.096;757,230.604;758,231.11;759,231.614;760,232.115;761,232.615;762,233.112;763,233.606;764,234.099;765,234.589;766,235.078;767,235.564;768,236.047;769,236.529;770,237.008;771,237.485;772,237.959;773,238.432;774,238.902;775,239.37;776,239.836;777,240.299;778,240.76;779,241.219;780,241.675;781,242.13;782,242.582;783,243.031;784,243.479;785,243.924;786,244.367;787,244.808;788,245.246;789,245.682;790,246.116;791,246.548;792,246.977;793,247.404;794,247.829;795,248.251;796,248.671;797,249.089;798,249.505;799,249.918;800,250.329;801,250.738;802,251.144;803,251.548;804,251.95;805,252.35;806,252.747;807,253.142;808,253.535;809,253.925;810,254.314;811,254.7;812,255.083;813,255.465;814,255.844;815,256.221;816,256.595;817,256.968;818,257.338;819,257.706;820,258.071;821,258.434;822,258.795;823,259.154;824,259.511;825,259.865;826,260.217;827,260.567;828,260.914;829,261.259;830,261.602";
let am0 = "300,0.420000;301,0.455500;302,0.489000;303,0.620600;304,0.602500;305,0.594800;306,0.555700;307,0.615000;308,0.611400;309,0.496500;310,0.622400;311,0.729200;312,0.655900;313,0.699900;314,0.662900;315,0.633000;316,0.633200;317,0.773900;318,0.664900;319,0.710500;320,0.805100;321,0.699500;322,0.688600;323,0.661300;324,0.760800;325,0.875800;326,0.979500;327,0.952700;328,0.917600;329,1.061000;330,1.016000;331,0.965700;332,0.954900;333,0.921600;334,0.958900;335,0.943400;336,0.809500;337,0.841800;338,0.921500;339,0.958100;340,1.007000;341,0.923800;342,0.993000;343,0.950600;344,0.795700;345,0.939200;346,0.926400;347,0.901700;348,0.897200;349,0.889800;350,1.050000;351,0.979500;352,0.907900;353,1.033000;354,1.111000;355,1.045000;356,0.912300;357,0.796000;358,0.693600;359,0.991100;360,0.970800;361,0.878100;362,0.997800;363,0.996900;364,1.013000;365,1.152000;366,1.233000;367,1.180000;368,1.101000;369,1.226000;370,1.139000;371,1.175000;372,1.054000;373,0.920200;374,0.900400;375,1.062000;376,1.085000;377,1.282000;378,1.327000;379,1.066000;380,1.202000;381,1.082000;382,0.791300;383,0.684100;384,0.959700;385,1.008000;386,1.007000;387,1.004000;388,0.984300;389,1.174000;390,1.247000;391,1.342000;392,1.019000;393,0.582300;394,1.026000;395,1.314000;396,0.854500;397,0.928800;398,1.522000;399,1.663000;400,1.682000;401,1.746000;402,1.759000;403,1.684000;404,1.674000;405,1.667000;406,1.589000;407,1.628000;408,1.735000;409,1.715000;410,1.532000;411,1.817000;412,1.789000;413,1.756000;414,1.737000;415,1.734000;416,1.842000;417,1.665000;418,1.684000;419,1.701000;420,1.757000;421,1.797000;422,1.582000;423,1.711000;424,1.767000;425,1.695000;426,1.698000;427,1.569000;428,1.587000;429,1.475000;430,1.135000;431,1.686000;432,1.646000;433,1.731000;434,1.670000;435,1.723000;436,1.929000;437,1.806000;438,1.567000;439,1.825000;440,1.713000;441,1.931000;442,1.980000;443,1.909000;444,1.973000;445,1.821000;446,1.891000;447,2.077000;448,1.973000;449,2.027000;450,2.144000;451,2.109000;452,1.941000;453,1.970000;454,1.979000;455,2.034000;456,2.077000;457,2.100000;458,1.971000;459,2.009000;460,2.040000;461,2.055000;462,2.104000;463,2.040000;464,1.976000;465,2.042000;466,1.921000;467,2.015000;468,1.994000;469,1.990000;470,1.877000;471,2.018000;472,2.041000;473,1.991000;474,2.051000;475,2.016000;476,1.956000;477,2.075000;478,2.009000;479,2.076000;480,2.035000;481,2.090000;482,2.023000;483,2.019000;484,1.969000;485,1.830000;486,1.625000;487,1.830000;488,1.914000;489,1.960000;490,2.007000;491,1.896000;492,1.896000;493,1.888000;494,2.058000;495,1.926000;496,2.017000;497,2.018000;498,1.866000;499,1.970000;500,1.857000;501,1.812000;502,1.894000;503,1.934000;504,1.869000;505,1.993000;506,1.961000;507,1.906000;508,1.919000;509,1.916000;510,1.947000;511,1.997000;512,1.867000;513,1.861000;514,1.874000;515,1.900000;516,1.669000;517,1.726000;518,1.654000;519,1.828000;520,1.831000;521,1.906000;522,1.823000;523,1.894000;524,1.958000;525,1.930000;526,1.674000;527,1.828000;528,1.897000;529,1.918000;530,1.952000;531,1.963000;532,1.770000;533,1.923000;534,1.858000;535,1.990000;536,1.871000;537,1.882000;538,1.904000;539,1.832000;540,1.769000;541,1.881000;542,1.825000;543,1.879000;544,1.879000;545,1.901000;546,1.879000;547,1.833000;548,1.863000;549,1.895000;550,1.862000;551,1.871000;552,1.846000;553,1.882000;554,1.898000;555,1.897000;556,1.821000;557,1.846000;558,1.787000;559,1.808000;560,1.843000;561,1.824000;562,1.850000;563,1.861000;564,1.854000;565,1.798000;566,1.829000;567,1.887000;568,1.810000;569,1.860000;570,1.769000;571,1.823000;572,1.892000;573,1.876000;574,1.867000;575,1.830000;576,1.846000;577,1.857000;578,1.783000;579,1.828000;580,1.838000;581,1.853000;582,1.873000;583,1.857000;584,1.860000;585,1.783000;586,1.830000;587,1.848000;588,1.750000;589,1.612000;590,1.813000;591,1.787000;592,1.808000;593,1.796000;594,1.773000;595,1.782000;596,1.805000;597,1.780000;598,1.757000;599,1.774000;600,1.746000;601,1.751000;602,1.719000;603,1.787000;604,1.776000;605,1.763000;606,1.759000;607,1.757000;608,1.743000;609,1.744000;610,1.703000;611,1.746000;612,1.705000;613,1.683000;614,1.713000;615,1.713000;616,1.609000;617,1.707000;618,1.724000;619,1.707000;620,1.734000;621,1.690000;622,1.713000;623,1.666000;624,1.656000;625,1.632000;626,1.697000;627,1.697000;628,1.697000;629,1.677000;630,1.658000;631,1.639000;632,1.645000;633,1.651000;634,1.653500;635,1.656000;636,1.655000;637,1.654000;638,1.652500;639,1.651000;640,1.632500;641,1.614000;642,1.617500;643,1.621000;644,1.624000;645,1.627000;646,1.615000;647,1.603000;648,1.580500;649,1.558000;650,1.582000;651,1.606000;652,1.602500;653,1.599000;654,1.565500;655,1.532000;656,1.458000;657,1.384000;658,1.466500;659,1.549000;660,1.560000;661,1.571000;662,1.563000;663,1.555000;664,1.557500;665,1.560000;666,1.547500;667,1.535000;668,1.540500;669,1.546000;670,1.531000;671,1.516000;672,1.518500;673,1.521000;674,1.515500;675,1.510000;676,1.509000;677,1.508000;678,1.503000;679,1.498000;680,1.495000;681,1.492000;682,1.485500;683,1.479000;684,1.467000;685,1.455000;686,1.461000;687,1.467000;688,1.464000;689,1.461000;690,1.454500;691,1.448000;692,1.448000;693,1.448000;694,1.442000;695,1.436000;696,1.426000;697,1.416000;698,1.420500;699,1.425000;700,1.405500;701,1.386000;702,1.387000;703,1.388000;704,1.401500;705,1.415000;706,1.407500;707,1.400000;708,1.392000;709,1.384000;710,1.384500;711,1.385000;712,1.379000;713,1.373000;714,1.369500;715,1.366000;716,1.360000;717,1.354000;718,1.341000;719,1.328000;720,1.329500;721,1.331000;722,1.339500;723,1.348000;724,1.349000;725,1.350000;726,1.348000;727,1.346000;728,1.332500;729,1.319000;730,1.322500;731,1.326000;732,1.322000;733,1.318000;734,1.313500;735,1.309000;736,1.308000;737,1.307000;738,1.292500;739,1.278000;740,1.268000;741,1.258000;742,1.272000;743,1.286000;744,1.282500;745,1.279000;746,1.281000;747,1.283000;748,1.276500;749,1.270000;750,1.266000;751,1.262000;752,1.260500;753,1.259000;754,1.257000;755,1.255000;756,1.251500;757,1.248000;758,1.244000;759,1.240000;760,1.238500;761,1.237000;762,1.239000;763,1.241000;764,1.231000;765,1.221000;766,1.203000;767,1.185000;768,1.194000;769,1.203000;770,1.203500;771,1.204000;772,1.206000;773,1.208000;774,1.198000;775,1.188000;776,1.192000;777,1.196000;778,1.191500;779,1.187000;780,1.187000;781,1.187000;782,1.181500;783,1.176000;784,1.178000;785,1.180000;786,1.178500;787,1.177000;788,1.175500;789,1.174000;790,1.166000;791,1.158000;792,1.150500;793,1.143000;794,1.138500;795,1.134000;796,1.143000;797,1.152000;798,1.143500;799,1.135000;800,1.138500;801,1.142000;802,1.135500;803,1.129000;804,1.122000;805,1.115000;806,1.117500;807,1.120000;808,1.107500;809,1.095000;810,1.104500;811,1.114000;812,1.114500;813,1.115000;814,1.111000;815,1.107000;816,1.105500;817,1.104000;818,1.083500;819,1.063000;820,1.071500;821,1.080000;822,1.076500;823,1.073000;824,1.074000;825,1.075000;826,1.080000;827,1.080500;828,1.081000;829,1.072000;830,1.063000";
let apple_reflectance = "400,0.06;410,0.05;420,0.05;430,0.04;440,0.04;450,0.03;460,0.03;470,0.025;480,0.02;490,0.02;500,0.02;510,0.015;520,0.015;530,0.01;540,0.01;550,0.015;560,0.05;570,0.15;580,0.3;590,0.45;600,0.6;610,0.7;620,0.75;630,0.8;640,0.82;650,0.85;660,0.86;670,0.87;680,0.88;690,0.89;700,0.9";

function create_spd_graph(scene, data, stuff, spd){
    data = data.split(";").map(point =>
        point.split(",").map(parseFloat)
    );

    let spd_graph_y_pos = -0.5;
    let spd_graph_position = [-1, 0, 0];
    let spd_graph_x_axis = ctx.create_drawable("shader_basic", create_arrow([0, spd_graph_y_pos, 0], [2.1, spd_graph_y_pos, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(spd_graph_position));
    let spd_graph_y_axis = ctx.create_drawable("shader_basic", create_arrow([0.01, spd_graph_y_pos, 0], [0.01, 0.7, 0], [0.02, 0.04, 0.04]), [0.4, 0.4, 0.4], translate_3d(spd_graph_position));
    let spd_graph_num_points = data.length;
    let spd_graph = [];
    for(let i = 0; i < spd_graph_num_points; i++){
        spd_graph.push(data[i][1]/stuff.scale_y+stuff.offset_y);
    }

    let spd_graph_drawable_points = [];
    let graph_width = 2.0;
    spd_graph_drawable_points.push([0, spd_graph_y_pos, 0]);
    for(let i = 0; i < spd_graph_num_points; i++){
        let x = i/spd_graph_num_points * graph_width;
        spd_graph_drawable_points.push([x, spd_graph[i], 0]);
    }
    spd_graph_drawable_points.push([graph_width, spd_graph_y_pos, 0]);

    let spd_graph_drawable = ctx.create_drawable("shader_spd", null, blue, translate_3d(spd_graph_position));
    let spd_graph_drawable_line = ctx.create_drawable("shader_basic", null, [0.3, 0.3, 0.3], translate_3d(spd_graph_position));
    ctx.update_drawable_mesh(spd_graph_drawable_line, create_line(spd_graph_drawable_points.slice(1, -1), 0.012, false));
    ctx.update_drawable_mesh(spd_graph_drawable, triangulate_points(spd_graph_drawable_points));

    ctx.text_buffers["spd_graph_x_axis_wavelength_text_"+scene] = {text: "300              400              500              600              700              800", color: [0, 0, 0], transform: mat4_mat4_mul(
        scale_3d([0.0015, 0.0015, 0.0015]),
        translate_3d([-0.9, -0.6, 0]))};
    ctx.text_buffers["spd_graph_x_axis_text_"+scene] = {text: "Wavelength (nm)", color: [0, 0, 0], transform: mat4_mat4_mul(
        scale_3d([0.002, 0.002, 0.002]),
        translate_3d([-0.34, -0.74, 0]))};
    ctx.text_buffers["spd_graph_y_axis_text_"+scene] = {text: spd ? "Relative power" : "Reflectance", color: [0, 0, 0], transform:
        mat4_mat4_mul(
            rotate_3d(axis_angle_to_quat([0, 0, 1], rad(90))),
            mat4_mat4_mul(
                scale_3d([0.002, 0.002, 0.002]),
                translate_3d([-1.05, -0.23, 0])
            ),
        )
    };

    ctx.scenes[scene].current_selection = 0;

    let current_selection_x = ctx.scenes[scene].current_selection/spd_graph_num_points * graph_width;
    let current_selection_y = data[ctx.scenes[scene].current_selection][1]/stuff.scale_y+stuff.offset_y;

    let spd_graph_selection_line_x = ctx.create_drawable("shader_basic", null, [0.3, 0.3, 0.3], translate_3d(spd_graph_position));
    ctx.update_drawable_mesh(spd_graph_selection_line_x, create_line_dashed([[current_selection_x, spd_graph_y_pos, 0], [current_selection_x, current_selection_y, 0]], 0.01, 0.03, 0.015, false));

    let spd_graph_selection_line_y = ctx.create_drawable("shader_basic", null, [0.3, 0.3, 0.3], translate_3d(spd_graph_position));
    ctx.update_drawable_mesh(spd_graph_selection_line_y, create_line_dashed([[0, current_selection_y, 0], [current_selection_x, current_selection_y, 0]], 0.01, 0.03, 0.015, false));

    update_camera_projection_matrix(ctx.scenes[scene].camera,  ctx.scenes[scene].width/ctx.scenes[scene].height);
    update_camera_orbit(ctx.scenes[scene].camera);

    let graph_screen_space_left = world_to_screen_space(ctx.scenes[scene], ctx.scenes[scene].camera, [-1, 0, 0])[0];
    let graph_screen_space_right = world_to_screen_space(ctx.scenes[scene], ctx.scenes[scene].camera, [spd_graph_drawable_points[spd_graph_drawable_points.length-1][0]-1, 0, 0])[0];
    ctx.scenes[scene].el.addEventListener("mousemove", function(e){
        const coords = get_event_coordinates(e, ctx.scenes[scene].el);
        let current_selection = ctx.scenes[scene].current_selection;
        let min_world_space = spd_graph_drawable_points[0][0];
        let max_world_space = spd_graph_drawable_points[spd_graph_drawable_points.length-1][0];
        let current_selection_x = clamp(remap_value(coords.x, graph_screen_space_left, graph_screen_space_right, min_world_space, max_world_space), min_world_space, max_world_space);

        let new_current_selection = Math.floor(current_selection_x/graph_width*spd_graph_num_points);
        if(new_current_selection > 0 && new_current_selection < data.length-1){
            current_selection = new_current_selection;
            ctx.scenes[scene].current_selection = new_current_selection;
            current_selection_x = current_selection/spd_graph_num_points * graph_width;
            let current_selection_y = data[current_selection][1]/stuff.scale_y+stuff.offset_y;
            ctx.update_drawable_mesh(spd_graph_selection_line_x, create_line_dashed([[current_selection_x, spd_graph_y_pos, 0], [current_selection_x, current_selection_y, 0]], 0.01, 0.03, 0.015, false));
            ctx.update_drawable_mesh(spd_graph_selection_line_y, create_line_dashed([[0, current_selection_y, 0], [current_selection_x, current_selection_y, 0]], 0.01, 0.03, 0.015, false));
        }
    });

    return {
        "spd_graph_x_axis": spd_graph_x_axis,
        "spd_graph_y_axis": spd_graph_y_axis,
        "spd_graph_drawable_line": spd_graph_drawable_line,
        "spd_graph_selection_line_x": spd_graph_selection_line_x,
        "spd_graph_selection_line_y": spd_graph_selection_line_y,
        "spd_graph_drawable": spd_graph_drawable,
        "spd_graph_x_axis_wavelength_text": "spd_graph_x_axis_wavelength_text_"+scene,
        "spd_graph_x_axis_text": "spd_graph_x_axis_text_"+scene,
        "spd_graph_y_axis_text": "spd_graph_y_axis_text_"+scene,
    };
}

let scenes_spd = {
    "scene_spd": create_spd_graph("scene_spd", cie_d65, {scale_y: 120.0, offset_y: -0.45}, true),
    "scene_spd_sun_space": create_spd_graph("scene_spd_sun_space", am0, {scale_y: 2.0, offset_y: -0.45}, true),
    "scene_spd_lamp": create_spd_graph("scene_spd_lamp", cie_a, {scale_y: 250.0, offset_y: -0.45}, true),
    "scene_apple_reflectance": create_spd_graph("scene_apple_reflectance", apple_reflectance, {scale_y: 1.0, offset_y: -0.45}, false),
};

// scene_spd

let fullscreen_quad = ctx.create_drawable("shader_postprocess", {
    vertices: [
        -1, -1, 0, 0, 0,
         1, -1, 0, 1, 0,
         1,  1, 0, 1, 1,
        -1,  1, 0, 0, 1
    ],
    indices: [
        0, 1, 2,
        0, 2, 3
    ]
}, [1, 0, 1], mat4_identity(), [
    { name: "position_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 }
]);

function weird_thing(scene, camera, point){
    let tmp = world_to_screen_space(scene, scene.camera, point);
    let tmp2 = screen_to_world_space(scene, tmp, camera.orbit.zoom, camera);
    return [tmp2[0], tmp2[1], 0];
}

ctx.frame_count = 0;
ctx.time = 0.0;
ctx.last_time = 0.0;

function update(current_time){
    let delta_time = (current_time - ctx.last_time) / 1000;
    ctx.last_time = current_time;
    delta_time = Math.min(delta_time, 0.1);
    ctx.time += delta_time;

    const gl = ctx.gl;
    gl.canvas.style.top = window.scrollY +  "px";
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.depthFunc(gl.LESS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.font_texture);

    const pixel_ratio = ctx.pixel_ratio || window.devicePixelRatio || 1;

    for(let scene_id in ctx.scenes){
        const scene = ctx.scenes[scene_id];
        ctx.current_scene = scene;
        const rect = scene.el.getBoundingClientRect();

        if (rect.bottom < 0 || rect.top > gl.canvas.clientHeight ||
            rect.right < 0 || rect.left > gl.canvas.clientWidth) {
            continue;
        }

        const css_width = rect.width;
        const css_height = rect.height;
        const css_left = rect.left - gl.canvas.getBoundingClientRect().left;
        const css_bottom = gl.canvas.clientHeight - (rect.bottom - gl.canvas.getBoundingClientRect().top);

        const width = Math.floor(css_width * pixel_ratio);
        const height = Math.floor(css_height * pixel_ratio);
        const left = Math.floor(css_left * pixel_ratio);
        const bottom = Math.floor(css_bottom * pixel_ratio);

        gl.viewport(left, bottom, width, height);
        gl.scissor(left, bottom, width, height);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        if(scene_id == "scene_charges"){
            for(const charge of scene.charges){
                let min_scale = 1.0;
                let max_scale = 1.3;
                let speed = delta_time * 2;

                if(charge.state == "hovered"){
                    charge.scale = Math.min(charge.scale + speed, max_scale);
                } else {
                    charge.scale = Math.max(charge.scale - speed, min_scale);
                }

                update_charge_size(charge, charge.scale);

                ctx.draw(charge.sign);
                ctx.draw(charge.charge);
                ctx.draw(charge.charge_background);
                ctx.draw(charge.arrow);
            }
        }
        else if(scene_id == "scene_metals"){
            if(!scene.done_shader_texture_setup){
                let shader = ctx.shaders["shader_pbr"];
                gl.useProgram(shader.program);
                albedo_location = gl.getUniformLocation(shader.program, "albedo_texture");
                metallic_location = gl.getUniformLocation(shader.program, "metallic_texture");
                roughness_location = gl.getUniformLocation(shader.program, "roughness_texture");
                normal_location = gl.getUniformLocation(shader.program, "normal_texture");
                envmap_specular_location = gl.getUniformLocation(shader.program, "envmap_specular");
                brdf_lut_location = gl.getUniformLocation(shader.program, "brdf_lut");
                envmap_diffuse_location = gl.getUniformLocation(shader.program, "envmap_diffuse");
                gl.uniform1i(albedo_location, 0);
                gl.uniform1i(metallic_location, 1);
                gl.uniform1i(roughness_location, 2);
                gl.uniform1i(normal_location, 3);
                gl.uniform1i(envmap_specular_location, 4);
                gl.uniform1i(brdf_lut_location, 5);
                gl.uniform1i(envmap_diffuse_location, 6);
                scene.done_shader_texture_setup = true;
            }

            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, envmaps["hotel_room"].specular_texture);

            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, textures["brdf_lut"].texture);

            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, envmaps["hotel_room"].diffuse_texture);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures["gold_albedo"].texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, textures["gold_metallic"].texture);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, textures["gold_roughness"].texture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, textures["gold_normal"].texture);
            ctx.draw(gold_sphere);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures["copper_albedo"].texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, textures["copper_metallic"].texture);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, textures["copper_roughness"].texture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, textures["copper_normal"].texture);
            ctx.draw(copper_sphere);
        }
        else if(scene_id == "scene_non_metals"){
            if(!scene.done_shader_texture_setup){
                let shader = ctx.shaders["shader_pbr"];
                gl.useProgram(shader.program);
                albedo_location = gl.getUniformLocation(shader.program, "albedo_texture");
                metallic_location = gl.getUniformLocation(shader.program, "metallic_texture");
                roughness_location = gl.getUniformLocation(shader.program, "roughness_texture");
                normal_location = gl.getUniformLocation(shader.program, "normal_texture");
                envmap_specular_location = gl.getUniformLocation(shader.program, "envmap_specular");
                brdf_lut_location = gl.getUniformLocation(shader.program, "brdf_lut");
                envmap_diffuse_location = gl.getUniformLocation(shader.program, "envmap_diffuse");
                gl.uniform1i(albedo_location, 0);
                gl.uniform1i(metallic_location, 1);
                gl.uniform1i(roughness_location, 2);
                gl.uniform1i(normal_location, 3);
                gl.uniform1i(envmap_specular_location, 4);
                gl.uniform1i(brdf_lut_location, 5);
                gl.uniform1i(envmap_diffuse_location, 6);
                scene.done_shader_texture_setup = true;
            }

            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, envmaps["hotel_room"].specular_texture);

            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, textures["brdf_lut"].texture);

            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, envmaps["hotel_room"].diffuse_texture);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures["plastic_albedo"].texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, textures["plastic_metallic"].texture);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, textures["plastic_roughness"].texture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, textures["plastic_normal"].texture);
            ctx.draw(plastic_sphere);
        }
        else if(scene_id == "scene_rusted_metal"){
            if(!scene.done_shader_texture_setup){
                let shader = ctx.shaders["shader_pbr"];
                gl.useProgram(shader.program);
                albedo_location = gl.getUniformLocation(shader.program, "albedo_texture");
                metallic_location = gl.getUniformLocation(shader.program, "metallic_texture");
                roughness_location = gl.getUniformLocation(shader.program, "roughness_texture");
                normal_location = gl.getUniformLocation(shader.program, "normal_texture");
                envmap_specular_location = gl.getUniformLocation(shader.program, "envmap_specular");
                brdf_lut_location = gl.getUniformLocation(shader.program, "brdf_lut");
                envmap_diffuse_location = gl.getUniformLocation(shader.program, "envmap_diffuse");
                gl.uniform1i(albedo_location, 0);
                gl.uniform1i(metallic_location, 1);
                gl.uniform1i(roughness_location, 2);
                gl.uniform1i(normal_location, 3);
                gl.uniform1i(envmap_specular_location, 4);
                gl.uniform1i(brdf_lut_location, 5);
                gl.uniform1i(envmap_diffuse_location, 6);
                scene.done_shader_texture_setup = true;
            }

            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, envmaps["hotel_room"].specular_texture);

            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, textures["brdf_lut"].texture);

            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, envmaps["hotel_room"].diffuse_texture);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures["rusted_metal_albedo"].texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, textures["rusted_metal_metallic"].texture);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, textures["rusted_metal_roughness"].texture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, textures["rusted_metal_normal"].texture);
            ctx.draw(rusted_metal_sphere);
        }
        else if(scene_id == "scene_normal_distribution_function"){
            ctx.draw(normal_distribution_sphere, {roughness: roughness_normal_distribution});
        }
        else if(scene_id == "scene_geometric_function"){
            ctx.draw(geometric_function_sphere, {roughness: roughness_geometric_function});
        }
        else if(scene_id == "scene_fresnel_equation"){
            ctx.draw(fresnel_equation_sphere, {base_reflectance: base_reflectance});
        }
        else if(scene_id == "scene_pbr_demo"){
            ctx.draw(pbr_demo_sphere, {albedo: albedo_pbr_demo, metallic: metallic_pbr_demo, roughness: roughness_pbr_demo, light_direction: [1, 1, 0]});
        }
        else if(scene_id == "scene_pbr_demo_grid"){
            for(let i = 0; i < pbr_demo_grid_spheres.length; i++){
                ctx.draw(pbr_demo_grid_spheres[i][0], {albedo: albedo_pbr_demo, metallic: pbr_demo_grid_spheres[i][1], roughness: pbr_demo_grid_spheres[i][2], light_direction: [2, 1, 2]});
            }
            ctx.draw(x_axis_arrow);
            ctx.draw(y_axis_arrow);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, ctx.font_texture);
            let metallic_text_position = weird_thing(scene, ui_camera_reflection_3d, [-2, -7, 0]);
            ctx.text_buffers["metallic_text"].transform = mat4_mat4_mul(scale_3d([0.0045, 0.0045, 0.0045]), mat4_mat4_mul(scale_3d([1, 1, 1]), translate_3d(metallic_text_position)));
            ctx.draw(ctx.text_buffers["metallic_text"], {}, ui_camera_reflection_3d);

            let roughness_text_position = weird_thing(scene, ui_camera_reflection_3d, [-3.3, 6.5, 0]);
            ctx.text_buffers["roughness_text"].transform = mat4_mat4_mul(scale_3d([0.0045, 0.0045, 0.0045]), mat4_mat4_mul(scale_3d([1, 1, 1]),
                mat4_mat4_mul(
                    translate_3d(roughness_text_position),
                    rotate_3d(axis_angle_to_quat([0, 0, 1], rad(90)))
                )
            ));
            ctx.draw(ctx.text_buffers["roughness_text"], {}, ui_camera_reflection_3d);
        }
        else if(scene_id == "scene_roughness_macro"){
            ctx.draw(roughness_macro_line);
            ctx.draw(roughness_macro_body);
            for(let i = 0; i < n_reflect_rays; i++){
                ctx.draw(reflected_light_arrows_macro[i]);
            }
            ctx.draw(incoming_light_arrow_macro);
        }
        else if(scene_id == "scene_roughness_metal"){
            ctx.draw(red_x_sign_first);
            ctx.draw(red_x_sign_second);
            for(let i = 0; i < n_reflect_rays; i++){
                ctx.draw(reflected_light_arrows_metal[i]);
            }
            for(let i = 0; i < n_reflect_rays; i++){
                ctx.draw(refracted_light_arrows_metal[i]);
            }
            ctx.draw(roughness_metal_line);
            ctx.draw(roughness_metal_body);
            ctx.draw(incoming_light_arrow_metal);
        }
        else if(scene_id == "scene_roughness_non_metal"){
            for(const particle of non_metal_particles){
                ctx.draw(particle);
            }

            for(let i = 0; i < n_reflect_rays; i++){
                ctx.draw(reflected_light_arrows_non_metal[i]);
            }
            for(let i = 0; i < n_refract_rays; i++){
                ctx.draw(refracted_light_arrows_non_metal[i]);
                ctx.draw(scattered_rays_non_metal[i]);
            }



            ctx.draw(roughness_non_metal_line);
            ctx.draw(roughness_non_metal_body);

            ctx.draw(incoming_light_arrow_non_metal);
        }
        else if(scene_id == "scene_roughness_micro"){
            ctx.draw(roughness_micro_line);
            ctx.draw(roughness_micro_body);
            for(let i = 0; i < 6; i++){
                ctx.draw(reflected_light_arrows[i]);
            }
            for(let i = 0; i < 6; i++){
                ctx.draw(incoming_light_arrows[i]);
            }
        }
        else if(scene_id == "scene_roughness_geometric_function"){
            ctx.draw(roughness_geometric_function_line);
            ctx.draw(roughness_geometric_function_body);
            for(let i = 0; i < num_geometric_roughness_rays; i++){
                ctx.draw(reflected_light_arrows_geometric_function[i]);
            }
            for(let i = 0; i < num_geometric_roughness_rays; i++){
                ctx.draw(incoming_light_arrows_geometric_function[i]);
            }
        }
        else if(scene_id == "scene_cosine_law"){
            ctx.draw(cosine_law_angle_curve);
            ctx.draw(cosine_law_center_line);
            ctx.draw(cosine_law_normal_line);
            ctx.draw(cosine_law_hit_line);
            for(let i = 0; i < cosine_law_num_arrows; i++){
                ctx.draw(cosine_law_incoming_light_arrows[i]);
            }
            ctx.draw(cosine_law_line);
            ctx.draw(cosine_law_body);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, ctx.font_texture);
            gl.depthFunc(gl.ALWAYS);
            ctx.draw(ctx.text_buffers["cosine_law_angle"]);
            ctx.draw(ctx.text_buffers["cosine_law_normal"]);
            ctx.draw(ctx.text_buffers["cosine_law_light"]);
            gl.depthFunc(gl.LESS);
        }
        else if(scene_id == "scene_electric_field"){
            for(const charge of scene.charges){
                let min_scale = 1.0;
                let max_scale = 1.3;
                let speed = delta_time * 2;

                if(charge.state == "hovered"){
                    charge.scale = Math.min(charge.scale + speed, max_scale);
                } else {
                    charge.scale = Math.max(charge.scale - speed, min_scale);
                }

                update_charge_size(charge, charge.scale);

                ctx.draw(charge.sign);
                ctx.draw(charge.charge);
                ctx.draw(charge.charge_background);
                ctx.draw(charge.arrow);
            }

            if(show_field_line){
                for(const line of scene.field_lines){
                    ctx.draw(line);
                }
            }
            else{
                for(const vector of scene.vector_field){
                    ctx.draw(vector);
                }
            }
        }
        else if(scene_id == "scene_snells"){
            ctx.draw(snells_incident_ray_1);
            ctx.draw(snells_incident_ray_2);
            ctx.draw(snells_refracted_ray_1);
            ctx.draw(snells_refracted_ray_2);
            ctx.draw(normal_line);
            ctx.draw(snells_angle_1_curve);
            ctx.draw(snells_angle_2_curve);
            ctx.draw(medium_boundary);
            ctx.draw(snells_medium_1);
            ctx.draw(snells_medium_2);

            gl.depthFunc(gl.ALWAYS);
            ctx.draw(ctx.text_buffers["snells_angle_1"]);
            ctx.draw(ctx.text_buffers["snells_angle_1_sub"]);
            ctx.draw(ctx.text_buffers["snells_angle_2"]);
            ctx.draw(ctx.text_buffers["snells_angle_2_sub"]);

            ctx.draw(ctx.text_buffers["snells_ior_1"]);
            ctx.draw(ctx.text_buffers["snells_ior_1_sub"]);
            ctx.draw(ctx.text_buffers["snells_ior_2"]);
            ctx.draw(ctx.text_buffers["snells_ior_2_sub"]);
            gl.depthFunc(gl.LESS);
        }
        else if(scene_id == "scene_fresnel"){
            ctx.draw(fresnel_incident_ray_1);
            ctx.draw(fresnel_incident_ray_2);
            ctx.draw(fresnel_refracted_ray_1);
            ctx.draw(fresnel_refracted_ray_2);
            ctx.draw(fresnel_reflected_ray_1);
            ctx.draw(fresnel_reflected_ray_2);
            ctx.draw(fresnel_angle_1_curve);
            ctx.draw(fresnel_angle_2_curve);
            ctx.draw(normal_line);
            ctx.draw(medium_boundary);
            ctx.draw(fresnel_medium_1);
            ctx.draw(fresnel_medium_2);

            gl.depthFunc(gl.ALWAYS);
            ctx.draw(ctx.text_buffers["fresnel_angle_1"]);
            ctx.draw(ctx.text_buffers["fresnel_angle_1_sub"]);
            ctx.draw(ctx.text_buffers["fresnel_angle_2"]);
            ctx.draw(ctx.text_buffers["fresnel_angle_2_sub"]);

            ctx.draw(ctx.text_buffers["fresnel_ior_1"]);
            ctx.draw(ctx.text_buffers["fresnel_ior_1_sub"]);
            ctx.draw(ctx.text_buffers["fresnel_ior_2"]);
            ctx.draw(ctx.text_buffers["fresnel_ior_2_sub"]);
            gl.depthFunc(gl.LESS);
        }
        else if(scene_id == "scene_reflection"){
            ctx.draw(reflection_incident_ray_1);
            ctx.draw(reflection_incident_ray_2);
            ctx.draw(reflection_reflected_ray_1);
            ctx.draw(reflection_reflected_ray_2);
            ctx.draw(reflection_angle_1_curve);
            ctx.draw(reflection_angle_2_curve);
            ctx.draw(normal_line);
            ctx.draw(reflection_medium_boundary);
            ctx.draw(reflection_medium_1);
            ctx.draw(reflection_medium_2);

            gl.depthFunc(gl.ALWAYS);
            ctx.draw(ctx.text_buffers["reflection_angle_1"]);
            ctx.draw(ctx.text_buffers["reflection_angle_1_sub"]);
            ctx.draw(ctx.text_buffers["reflection_angle_2"]);
            ctx.draw(ctx.text_buffers["reflection_angle_2_sub"]);
            gl.depthFunc(gl.LESS);
        }
        else if(scene_id === "scene_snells_window") {
            update_camera_orbit(scene.camera);
            let camera_underwater = scene.camera.position[1] < 0.0;

            if(!scene.done_shader_texture_setup){
                let shader = ctx.shaders["shader_water"];
                gl.useProgram(shader.program);
                envmap_sky_location = gl.getUniformLocation(shader.program, "envmap_sky");
                gl.uniform1i(envmap_sky_location, 0);
                let water_density_location = gl.getUniformLocation(shader.program, "water_density");
                gl.uniform1f(water_density_location, water_density);
                let water_ior_location = gl.getUniformLocation(shader.program, "water_ior");
                gl.uniform1f(water_ior_location, water_ior);

                shader = ctx.shaders["shader_skybox"];
                gl.useProgram(shader.program);
                envmap_sky_location = gl.getUniformLocation(shader.program, "envmap_sky");
                gl.uniform1i(envmap_sky_location, 0);
                water_density_location = gl.getUniformLocation(shader.program, "water_density");
                gl.uniform1f(water_density_location, water_density);
                water_ior_location = gl.getUniformLocation(shader.program, "water_ior");
                gl.uniform1f(water_ior_location, water_ior);

                scene.done_shader_texture_setup = true;
            }

            ctx.gl.bindFramebuffer(ctx.gl.FRAMEBUFFER, null);
            gl.cullFace(gl.BACK);
            gl.depthFunc(gl.LEQUAL);
            gl.useProgram(ctx.shaders["shader_skybox"].program);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures["envmap_sky"].texture);
            let skybox_shader = ctx.shaders["shader_skybox"];
            if(skybox_shader.uniforms.hasOwnProperty("underwater_mode")){
                gl.uniform1i(skybox_shader.uniforms["underwater_mode"].location, camera_underwater ? 1 : 0);
            }
            if(skybox_shader.uniforms.hasOwnProperty("camera_pos_world")){
                gl.uniform3fv(skybox_shader.uniforms["camera_pos_world"].location, scene.camera.position);
            }
            if(skybox_shader.uniforms.hasOwnProperty("water_density")){
                gl.uniform1f(skybox_shader.uniforms["water_density"].location, water_density);
            }
            if(skybox_shader.uniforms.hasOwnProperty("water_ior")){
                gl.uniform1f(skybox_shader.uniforms["water_ior"].location, water_ior);
            }
            gl.cullFace(gl.FRONT);
            ctx.draw(skybox);

            gl.depthFunc(gl.LESS);
            gl.cullFace(gl.BACK);
            if(!camera_underwater){
                gl.useProgram(ctx.shaders["shader_water"].program);
                let water_shader = ctx.shaders["shader_water"];
                if(water_shader.uniforms.hasOwnProperty("water_density")){
                    gl.uniform1f(water_shader.uniforms["water_density"].location, water_density);
                }
                if(water_shader.uniforms.hasOwnProperty("water_ior")){
                    gl.uniform1f(water_shader.uniforms["water_ior"].location, water_ior);
                }

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, textures["envmap_sky"].texture);

                gl.disable(gl.BLEND);
                gl.disable(gl.CULL_FACE);
                ctx.draw(water_surface);
                gl.enable(gl.CULL_FACE);
                gl.enable(gl.BLEND);
                gl.cullFace(gl.BACK);
            }
        }
        else if(scene_id === "scene_total_internal_reflection") {
            for(let i = 0; i < tir_rays.length; i++){
                ctx.draw(tir_rays[i]);
                ctx.draw(tir_secondary_rays[i]);
            }
            ctx.draw(tir_medium_boundary);
            ctx.draw(tir_medium_water);
            ctx.draw(tir_medium_air);
        }
        else if(scene_id == "scene_spectrum"){
            ctx.draw(spectrum);
            ctx.draw(spectrum_background);
            wave_param_spectrum.time += 7.0*delta_time;
            spectrum_wave.color = wavelength_to_rgb(wave_param_spectrum.frequency, 3.35, 2.14);
            ctx.update_wave_3d(spectrum_wave, wave_param_spectrum, lines_segments_3d);
            ctx.draw(spectrum_wave);
            ctx.draw(arrow);
            ctx.draw(ctx.text_buffers["gamma_ray_text_wavelength"]);
            ctx.draw(ctx.text_buffers["gamma_ray_text"]);
        }
        else if(scene_id == "scene_wave"){
            ctx.update_wave_3d(wave_3d, wave_param, lines_segments_3d);

            wave_3d.color = blue;
            wave_3d.transform = translate_3d([-2, 0, 0]);
            ctx.draw(wave_3d);

            wave_3d.color = red;
            wave_3d.transform = mat4_mat4_mul(translate_3d([-2, 0, 0]), rotate_3d(axis_angle_to_quat([1, 0, 0], rad(90))));
            ctx.draw(wave_3d);

            wave_param.time += 2.0*delta_time;

            ctx.draw(x_axis);
            ctx.draw(y_axis);
            ctx.draw(z_axis);
        }
        else if(scene_id == "scene_field_gradient"){
            ctx.draw(plane);
        }
        else if(scene_id == "scene_induction"){
            if(magnet_pos_average.length < 10){
                magnet_pos_average.push(0);
            }
            else{
                magnet_pos_average.push(0);
                magnet_pos_average.shift();
            }

            let average = 0;
            for(let i = 0; i < magnet_pos_average.length; i++){
                average += magnet_pos_average[i];
            }
            average /= magnet_pos_average.length;

            induction_current = average;

            voltmeter_arrow.transform = mat4_mat4_mul(
                mat4_mat4_mul(
                    rotate_3d(axis_angle_to_quat(vec3_normalize([0, 0, 1]), rad(remap_value(average, -1, 1, 85, -85)))),
                    translate_3d([0, 0.3, 4]),
                ),
                voltmeter_transform,
            );

            ctx.draw(coil);

            if(show_magnetic_field){
                for(let line of magnetic_field_drawables){
                    ctx.draw(line);
                }
            }

            gl.disable(gl.DEPTH_TEST);

            for(let i = 0; i < num_electrons_induction; i++){
                coil_electrons_induction[i][1] += delta_time*induction_current*0.06;
                if(coil_electrons_induction[i][1] > 1){
                    coil_electrons_induction[i][1] = 0;
                }
                if(coil_electrons_induction[i][1] < 0){
                    coil_electrons_induction[i][1] = 1;
                }

                coil_electrons_induction[i][0].transform = mat4_mat4_mul(
                    scale_3d([2, 2, 2]),
                    mat4_mat4_mul(
                        translate_3d(get_position_along_path(path_induction, coil_electrons_induction[i][1])),
                        mat4_mat4_mul(
                            scale_3d([0.234, 0.234, 0.234]),
                            translate_3d([0.01, 0.6, 0]),
                        ),
                    )
                );
                ctx.draw(coil_electrons_induction[i][0]);
            }

            gl.enable(gl.DEPTH_TEST);

            ctx.draw(voltmeter);
            ctx.draw(voltmeter_screen);
            ctx.draw(voltmeter_arrow);
            ctx.draw(magnet_south);
            ctx.draw(magnet_north);

        }
        else if(scene_id == "scene_ampere"){
            if(average_ampere_voltage.length < 10){
                average_ampere_voltage.push(ampere_voltage > 0 ? 1 : -1);
            }
            else{
                average_ampere_voltage.push(ampere_voltage > 0 ? 1 : -1);
                average_ampere_voltage.shift();
            }
            let average = 0;
            for(let i = 0; i < average_ampere_voltage.length; i++){
                average += average_ampere_voltage[i];
            }
            average /= average_ampere_voltage.length;
            update_ampere_scene(ampere_voltage, average);

            ctx.draw(coil_ampere);

            gl.disable(gl.DEPTH_TEST);
            for(let i = 0; i < num_electrons_ampere; i++){
                coil_electrons_ampere[i][1] += delta_time*0.05*ampere_voltage;
                if(coil_electrons_ampere[i][1] > 1){
                    coil_electrons_ampere[i][1] = 0;
                }
                if(coil_electrons_ampere[i][1] < 0){
                    coil_electrons_ampere[i][1] = 1;
                }

                coil_electrons_ampere[i][0].transform = mat4_mat4_mul(
                    scale_3d([1.5, 1.5, 1.5]),
                    mat4_mat4_mul(
                        translate_3d(get_position_along_path(path_ampere, coil_electrons_ampere[i][1])),
                        mat4_mat4_mul(
                            scale_3d([0.42, 0.42, 0.42]),
                            translate_3d([0.01, -0.1, 0]),
                        ),
                    )
                );
                ctx.draw(coil_electrons_ampere[i][0]);
            }
            gl.enable(gl.DEPTH_TEST);

            ctx.draw(battery1);
            ctx.draw(battery2);
            ctx.draw(battery_cap1);
            ctx.draw(battery_cap2);
            ctx.draw(magnet);
            ctx.draw(magnet_arrow1);
            ctx.draw(magnet_arrow2);
        }
        else if(scene_id == "scene_apple_lights"){
            apple_color = vec3_hadamard([1, 0, 0], flashlight_color);
            apple_stem_color = vec3_hadamard([0.467, 0.318, 0.251], flashlight_color);
            apple_leaf_color = vec3_hadamard([0.380, 0.627, 0.149], flashlight_color);
            apple.color = apple_color;
            apple_stem.color = apple_stem_color;
            apple_leaf.color = apple_leaf_color;

            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            let light_pos = [-1, 0.5, 0.1];
            ctx.draw(flashlight);
            ctx.draw(flashlight_inside);

            apple.transform = apple_transform_flashlight;
            ctx.draw(apple, {"light_pos": light_pos, "specular_factor": 0});
            apple_stem.transform = apple_transform_flashlight;
            ctx.draw(apple_stem, {"light_pos": light_pos});
            apple_leaf.transform = apple_transform_flashlight;
            ctx.draw(apple_leaf, {"light_pos": light_pos});

            gl.cullFace(gl.FRONT);
            ctx.draw(flashlight_light, {"alpha": flashlight_light.alpha});
            gl.cullFace(gl.BACK);
            ctx.draw(flashlight_light, {"alpha": flashlight_light.alpha});

            gl.disable(gl.DEPTH_TEST);

            ctx.draw(small_graph_spd["graph_x_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_spd["graph_y_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_spd["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);

            ctx.draw(small_graph_apple["graph_x_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_apple["graph_y_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_apple["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);

            ctx.draw(small_graph_result["graph_x_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_result["graph_y_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_result["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);
            ctx.draw(multiply_sign, {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(equal_sign1, {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(equal_sign2, {"metallic": 0}, ui_camera_small_graph);

            gl.enable(gl.DEPTH_TEST);
        }
        else if(scene_id == "scene_metamers"){
            apple_color = vec3_hadamard([1, 0, 0], flashlight_color_m);
            apple_stem_color = vec3_hadamard([0.467, 0.318, 0.251], flashlight_color_m);
            apple_leaf_color = vec3_hadamard([0.380, 0.627, 0.149], flashlight_color_m);
            apple.color = apple_color;
            apple_stem.color = apple_stem_color;
            apple_leaf.color = apple_leaf_color;

            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            let light_pos = [-1, 0.5, 0.1];
            ctx.draw(flashlight);
            ctx.draw(flashlight_inside_m);

            apple.transform = apple_transform_metamers;
            ctx.draw(apple, {"light_pos": light_pos, "specular_factor": 0});
            apple_stem.transform = apple_transform_metamers;
            ctx.draw(apple_stem, {"light_pos": light_pos});
            apple_leaf.transform = apple_transform_metamers;
            ctx.draw(apple_leaf, {"light_pos": light_pos});

            banana.color = vec3_hadamard([0.88, 0.8, 0], flashlight_color_m);
            ctx.draw(banana, {"light_pos": light_pos, "specular_factor": 1});
            banana_head.color = vec3_hadamard([0.432, 0.220, 0.032], flashlight_color_m);
            ctx.draw(banana_head, {"light_pos": light_pos, "specular_factor": 1});

            gl.cullFace(gl.FRONT);
            ctx.draw(flashlight_light_m, {"alpha": flashlight_light_m.alpha});
            gl.cullFace(gl.BACK);
            ctx.draw(flashlight_light_m, {"alpha": flashlight_light_m.alpha});

            gl.disable(gl.DEPTH_TEST);

            ctx.draw(small_graph_apple_metamers["graph_x_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_apple_metamers["graph_y_axis"], {"metallic": 0}, ui_camera_small_graph);

            ctx.draw(small_graph_spd_metamers["graph_x_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_spd_metamers["graph_y_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_spd_metamers["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);

            if(show_apple_graph){
                ctx.draw(small_graph_banana["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 1}, ui_camera_small_graph);
                ctx.draw(small_graph_apple_metamers["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);
            }
            else{
                ctx.draw(small_graph_apple_metamers["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 1}, ui_camera_small_graph);
                ctx.draw(small_graph_banana["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);
            }

            ctx.draw(small_graph_result_metamers_banana["graph_x_axis"], {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(small_graph_result_metamers_banana["graph_y_axis"], {"metallic": 0}, ui_camera_small_graph);

            if(show_apple_graph){
                ctx.draw(small_graph_result_metamers_banana["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 1}, ui_camera_small_graph);
                ctx.draw(small_graph_result_metamers_apple["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);
            }
            else{
                ctx.draw(small_graph_result_metamers_apple["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 1}, ui_camera_small_graph);
                ctx.draw(small_graph_result_metamers_banana["graph_drawable_line"], {"metallic": 0, "small_graph": 1, "grayed": 0}, ui_camera_small_graph);
            }


            ctx.draw(multiply_sign, {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(equal_sign1, {"metallic": 0}, ui_camera_small_graph);
            ctx.draw(equal_sign2, {"metallic": 0}, ui_camera_small_graph);

            gl.enable(gl.DEPTH_TEST);
        }
        else if(scene_id == "scene_apple"){
            wave_red_2_3d.color = red;
            wave_red_3d.color = red;
            wave_blue_3d.color = [0.000, 0.493, 1.000];
            wave_green_3d.color = green;
            wave_violet_3d.color = [0.557, 0.000, 1.000];
            wave_param_apple.time += 0.05;
            wave_param_2_apple.time -= 0.05;
            ctx.update_wave_3d(wave_red_2_3d, wave_param_2_apple, lines_segments_3d);
            ctx.update_wave_3d(wave_red_3d, wave_param_apple, lines_segments_3d);
            ctx.update_wave_3d(wave_green_3d, wave_param_apple, lines_segments_3d);
            ctx.update_wave_3d(wave_blue_3d, wave_param_apple, lines_segments_3d);
            ctx.update_wave_3d(wave_violet_3d, wave_param_apple, lines_segments_3d);
            ctx.draw(wave_red_2_3d);
            ctx.draw(wave_red_3d);
            ctx.draw(wave_green_3d);
            ctx.draw(wave_blue_3d);
            ctx.draw(wave_violet_3d);
            apple.transform = apple_transform;

            apple_color = [1, 0, 0];
            apple_stem_color = [0.467, 0.318, 0.251];
            apple_leaf_color = [0.380, 0.627, 0.149];
            apple.color = apple_color;
            apple_stem.color = apple_stem_color;
            apple_leaf.color = apple_leaf_color;

            ctx.draw(apple, {"light_pos": [0, 1, 1], "specular_factor": 0});
            apple_stem.transform = apple_transform;
            ctx.draw(apple_stem, {"light_pos": [0, 1, 1]});
            apple_leaf.transform = apple_transform;
            ctx.draw(apple_leaf, {"light_pos": [0, 1, 1]});
        }
        else if(scene_id in scenes_spd){
            for(const [key, scene] of Object.entries(scenes_spd)){
                if(scene_id == key){
                    ctx.draw(scene["spd_graph_x_axis"]);
                    ctx.draw(scene["spd_graph_y_axis"]);
                    ctx.draw(scene["spd_graph_drawable_line"]);
                    ctx.draw(scene["spd_graph_selection_line_x"]);
                    ctx.draw(scene["spd_graph_selection_line_y"]);
                    ctx.draw(scene["spd_graph_drawable"], {"small_graph": 0});
                    ctx.draw(ctx.text_buffers[scene["spd_graph_x_axis_wavelength_text"]]);
                    ctx.draw(ctx.text_buffers[scene["spd_graph_x_axis_text"]]);
                    ctx.draw(ctx.text_buffers[scene["spd_graph_y_axis_text"]]);
                }
            }
        }
        else if(scene_id == "scene_bulb_graphs"){
            ctx.draw(scene_bulb_graph_x_axis);
            ctx.draw(scene_bulb_graph_y_axis);

            let current_voltage_mapped = remap_value(current_voltage, 0, 220, 0.1, 0.8);
            voltage_graph.push(current_voltage_mapped);
            voltage_graph.shift();

            voltage_graph_drawable_points = [];
            for(let i = 0; i < voltage_graph.length; i++){
                let x = i * 1.3 / (graph_num_points-1);
                voltage_graph_drawable_points.push([x, voltage_graph[i], 0]);
            }
            ctx.update_drawable_mesh(voltage_graph_drawable, create_line(voltage_graph_drawable_points, 0.03, false));

            ctx.draw(voltage_graph_drawable);
            ctx.draw(ctx.text_buffers["graph_voltage_y_axis"]);
            ctx.draw(ctx.text_buffers["graph_voltage_y_max"]);
            ctx.draw(ctx.text_buffers["graph_voltage_y_min"]);

            ctx.draw(scene_bulb_graph_x_axis_temperature);
            ctx.draw(scene_bulb_graph_y_axis_temperature);

            current_temperature = 20 + 0.759 * Math.pow(current_voltage, 1.5);
            let current_temperature_mapped = remap_value(current_temperature, 20, 2500, 0.1, 0.8);
            temperature_graph.push(current_temperature_mapped);
            temperature_graph.shift();

            temperature_graph_drawable_points = [];
            for(let i = 0; i < temperature_graph.length; i++){
                let x = i * 1.3 / (graph_num_points-1);
                temperature_graph_drawable_points.push([x, temperature_graph[i], 0]);
            }
            ctx.update_drawable_mesh(temperature_graph_drawable, create_line(temperature_graph_drawable_points, 0.03, false));

            ctx.draw(temperature_graph_drawable);
            ctx.draw(ctx.text_buffers["graph_temperature_y_axis"]);
            ctx.draw(ctx.text_buffers["graph_temperature_y_max"]);
            ctx.draw(ctx.text_buffers["graph_temperature_y_min"]);

            ctx.draw(scene_bulb_graph_x_axis_current);
            ctx.draw(scene_bulb_graph_y_axis_current);

            let current_resistance = 10 * (1 + 0.0045 * (current_temperature - 20));
            current_current = current_voltage / current_resistance;
            let current_current_mapped = remap_value(current_current, 0, 2.3, 0.1, 0.8);
            current_graph.push(current_current_mapped);
            current_graph.shift();

            current_graph_drawable_points = [];
            for(let i = 0; i < current_graph.length; i++){
                let x = i * 1.3 / (graph_num_points-1);
                current_graph_drawable_points.push([x, current_graph[i], 0]);
            }
            ctx.update_drawable_mesh(current_graph_drawable, create_line(current_graph_drawable_points, 0.03, false));

            ctx.draw(current_graph_drawable);
            ctx.draw(ctx.text_buffers["graph_current_y_axis"]);
            ctx.draw(ctx.text_buffers["graph_current_y_max"]);
            ctx.draw(ctx.text_buffers["graph_current_y_min"]);
        }
        else if(scene_id == "scene_reflection_3d"){
            ctx.draw(hemisphere_base, {"alpha": 0.5});
            ctx.draw(hemisphere, {"alpha": 0.4});

            gl.clear(gl.DEPTH_BUFFER_BIT);

            ctx.draw(outgoing_light_arrow);
            ctx.draw(incoming_light_arrow);
            ctx.draw(normal_arrow);
            for(let i = 0; i < brdf_arrow_num; i++){
                ctx.draw(brdf_arrows[i]);
            }

            gl.depthFunc(gl.ALWAYS);
            gl.disable(gl.CULL_FACE);

            let outgoing_light_text_position = weird_thing(scene, ui_camera_reflection_3d, outgoing_light_arrow_end);
            let outgoing_light_text_offset = [0.1, 0, 0];
            ctx.text_buffers["outgoing_light"].transform = mat4_mat4_mul(scale_3d([0.0045, 0.0045, 0.0045]), translate_3d(vec3_add(outgoing_light_text_position, outgoing_light_text_offset)));
            ctx.draw(ctx.text_buffers["outgoing_light"], {}, ui_camera_reflection_3d);
            ctx.text_buffers["outgoing_light_sub"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(vec3_add(outgoing_light_text_position, vec3_add(outgoing_light_text_offset, [0.12, -0.05, 0]))));
            ctx.draw(ctx.text_buffers["outgoing_light_sub"], {}, ui_camera_reflection_3d);

            let incoming_light_text_position = weird_thing(scene, ui_camera_reflection_3d, incoming_light_arrow_start);
            let incoming_light_text_offset = [0.1, 0, 0];
            ctx.text_buffers["incoming_light"].transform = mat4_mat4_mul(scale_3d([0.0045, 0.0045, 0.0045]), translate_3d(vec3_add(incoming_light_text_position, incoming_light_text_offset)));
            ctx.draw(ctx.text_buffers["incoming_light"], {}, ui_camera_reflection_3d);
            ctx.text_buffers["incoming_light_sub"].transform = mat4_mat4_mul(scale_3d([0.003, 0.003, 0.003]), translate_3d(vec3_add(incoming_light_text_position, vec3_add(incoming_light_text_offset, [0.12, -0.05, 0]))));
            ctx.draw(ctx.text_buffers["incoming_light_sub"], {}, ui_camera_reflection_3d);

            let normal_text_position = weird_thing(scene, ui_camera_reflection_3d, normal_arrow_end);
            let normal_text_offset = [0.1, 0, 0];
            ctx.text_buffers["normal"].transform = mat4_mat4_mul(scale_3d([0.0045, 0.0045, 0.0045]), translate_3d(vec3_add(normal_text_position, normal_text_offset)));
            ctx.draw(ctx.text_buffers["normal"], {}, ui_camera_reflection_3d);

            let omega_text_position = weird_thing(scene, ui_camera_reflection_3d, [0.28, -0.05, 0]);
            ctx.text_buffers["hemisphere_omega"].transform = mat4_mat4_mul(scale_3d([0.0045, 0.0045, 0.0045]), mat4_mat4_mul(scale_3d([1.5, 1.5, 1.5]), translate_3d(omega_text_position)));
            ctx.draw(ctx.text_buffers["hemisphere_omega"], {}, ui_camera_reflection_3d);

            gl.enable(gl.CULL_FACE);
            gl.depthFunc(gl.LESS);
        }
        else if(scene_id == "scene_sun"){
            for (let i = 0; i < num_rays; i++) {
                if (photon_steps[i] < photon_walks[i].length) {
                    photon_steps[i]++;
                    ctx.update_drawable_mesh(photon_rays[i], create_line_3d(photon_walks[i].slice(0, photon_steps[i]), 0.01, 16));

                    if (photon_steps[i] === photon_walks[i].length - 1) {
                        const exit_point = photon_walks[i][photon_walks[i].length - 1];
                        sphere_positions[i] = [...exit_point];
                        const photon_velocity = 1.0;
                        sphere_velocities[i] = [exit_point[0] * photon_velocity, exit_point[1] * photon_velocity, exit_point[2] * photon_velocity];
                        sphere_active[i] = true;
                        ejected_spheres[i].transform = translate_3d(sphere_positions[i]);
                    }
                } else {
                    photon_waits[i]++;
                    if (photon_waits[i] > 40) {
                        photon_walks[i] = generate_random_photon_walk();
                        photon_steps[i] = 1;
                        photon_waits[i] = 0;
                    }
                }

                if (sphere_active[i]) {
                    sphere_positions[i][0] += sphere_velocities[i][0]*delta_time;
                    sphere_positions[i][1] += sphere_velocities[i][1]*delta_time;
                    sphere_positions[i][2] += sphere_velocities[i][2]*delta_time;
                    ejected_spheres[i].transform = translate_3d(sphere_positions[i]);

                    const distance = Math.sqrt(
                        sphere_positions[i][0] * sphere_positions[i][0] +
                        sphere_positions[i][1] * sphere_positions[i][1] +
                        sphere_positions[i][2] * sphere_positions[i][2]
                    );

                    if (distance > 2) {
                        sphere_active[i] = false;
                        sphere_positions[i] = [0, 0, 0];
                        sphere_velocities[i] = [0, 0, 0];
                        ejected_spheres[i].transform = translate_3d([10, 10, 10]);
                    }
                }
            }

            gl.depthFunc(gl.LESS);

            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            sun_core.transform = scale_3d([1, 1, 1]);
            ctx.draw(sun_surface);
            ctx.draw(sun_cross);
            ctx.draw(sun_core);

            for(let ray of photon_rays){
                ctx.draw(ray);
            }

            for(let sphere of ejected_spheres){
                ctx.draw(sphere);
            }

            gl.depthFunc(gl.ALWAYS);

            ctx.draw(line_core, {"metallic": 0}, ui_camera_sun);
            ctx.update_drawable_mesh(line_core, create_line_dashed([
                vec3_add(core_text_position, [-0.04, 0, 0]),
                weird_thing(scene, ui_camera_sun, core_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(ctx.text_buffers["sun_core"], {}, ui_camera_sun);

            ctx.draw(line_radiativezone, {"metallic": 0}, ui_camera_sun);
            ctx.update_drawable_mesh(line_radiativezone, create_line_dashed([
                vec3_add(radiativezone_text_position, [-0.03, -0.05, 0]),
                weird_thing(scene, ui_camera_sun, radiativezone_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(ctx.text_buffers["sun_radiativezone"], {}, ui_camera_sun);

            ctx.draw(line_convectivezone, {"metallic": 0}, ui_camera_sun);
            ctx.update_drawable_mesh(line_convectivezone, create_line_dashed([
                vec3_add(convectivezone_text_position, [0.35, -0.05, 0]),
                weird_thing(scene, ui_camera_sun, convectivezone_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(ctx.text_buffers["sun_convectivezone"], {}, ui_camera_sun);

            ctx.draw(line_photosphere, {"metallic": 0}, ui_camera_sun);
            ctx.update_drawable_mesh(line_photosphere, create_line_dashed([
                vec3_add(photosphere_text_position, [0.35, -0.05, 0]),
                weird_thing(scene, ui_camera_sun, photosphere_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(ctx.text_buffers["sun_photosphere"], {}, ui_camera_sun);
        }
        else if(scene_id == "scene_led"){
            ctx.draw(led_reflective_case, {"metallic": 1.0});
            ctx.draw(led_metal, {"metallic": 0.0});
            ctx.draw(led_epoxy_case, {"alpha": 0.5, "metallic": 0.0});

            update_camera_projection_matrix(scene.camera, scene.width/scene.height);
            update_camera_orbit(scene.camera);

            ctx.update_drawable_mesh(line_epoxy_case, create_line_dashed([
                vec3_add(epoxy_case_text_position, [0.3, -0.05, 0]),
                weird_thing(scene, ui_camera_led, epoxy_case_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(line_epoxy_case, {"metallic": 0}, ui_camera_led);
            ctx.draw(ctx.text_buffers["epoxy_case"], {}, ui_camera_led);

            ctx.update_drawable_mesh(line_wire, create_line_dashed([
                vec3_add(wire_text_position, [0.3, -0.05, 0]),
                weird_thing(scene, ui_camera_led, wire_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(line_wire, {"metallic": 0}, ui_camera_led);
            ctx.draw(ctx.text_buffers["wire"], {}, ui_camera_led);

            ctx.update_drawable_mesh(line_semiconductor, create_line_dashed([
                vec3_add(semiconductor_text_position, [0.3, -0.05, 0]),
                weird_thing(scene, ui_camera_led, semiconductor_position)
            ], 0.01, 0.03, 0.015));
            ctx.draw(line_semiconductor, {"metallic": 0}, ui_camera_led);
            ctx.draw(ctx.text_buffers["semiconductor"], {}, ui_camera_led);
        }
        else if(scene_id == "scene_bulb"){
            ctx.draw(bulb_screw, {"metallic": 1});
            ctx.draw(bulb_screw_black, {"metallic": 0});
            ctx.draw(bulb_wire, {"metallic": 0});
            ctx.draw(bulb_wire_holder, {"metallic": 0});
            ctx.draw(bulb2, {"alpha": 0.4});
            ctx.draw(bulb, {"alpha": 0.4});

            gl.clear(gl.STENCIL_BUFFER_BIT);
            gl.enable(gl.STENCIL_TEST);

            gl.stencilMask(0xFF);
            gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
            gl.stencilOp(gl.REPLACE, gl.REPLACE, gl.REPLACE);

            gl.colorMask(false, false, false, false);
            gl.depthMask(false);
            ctx.draw(mask_circle, { "metallic": 0 }, ui_camera);

            gl.colorMask(true, true, true, true);
            gl.depthMask(true);
            gl.stencilFunc(gl.EQUAL, 1, 0xFF);
            gl.stencilMask(0x00);

            gl.depthFunc(gl.ALWAYS);

            for (const particle_id of tungsten_particles) {
                const particle = scene.particles[particle_id];
                ctx.draw(particle.particle_background, { "metallic": 0 }, ui_camera);
                ctx.draw(particle.particle, { "metallic": 0 }, ui_camera);
                ctx.draw(ctx.text_buffers[particle.text_id], {"metallic": 0}, ui_camera);
                particle.particle.color = vec3_lerp([0.7, 0.7, 0.7], [0.961, 0.550, 0.351], remap_value(current_temperature, 20, 2500, 0, 1));
            }

            for (const particle_id of electron_particles) {
                const particle = scene.particles[particle_id];
                ctx.draw(particle.particle_background, { "metallic": 0 }, ui_camera);
                ctx.draw(particle.particle, { "metallic": 0 }, ui_camera);
                ctx.draw(ctx.text_buffers[particle.text_id], {"metallic": 0}, ui_camera);

                let dx = particle.pos[0] - zoom_circle_pos[0];
                let dy = particle.pos[1] - zoom_circle_pos[1];
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (particle.pos[0] > zoom_circle_pos[0] + zoom_circle_radius) {
                    particle.pos[0] = zoom_circle_pos[0] - zoom_circle_radius;
                } else {
                    particle.pos[0] += remap_value(current_current, 0, 2, 0, 0.8) * delta_time;
                }

                update_particle_pos(particle);

                ctx.text_buffers[particle.text_id].transform = mat4_mat4_mul(
                    scale_3d([0.0025, 0.0025, 0.0025]),
                    translate_3d(vec3_sub(particle.pos, [0.032, 0.03, 0.0])),
                );
            }

            for (let photon_wave of photon_waves) {
                let skip_rate = Math.floor(remap_value(current_voltage, 80, 220, 6, 0));
                if (skip_rate < 0) skip_rate = 0;
                if (skip_rate > number_photons) skip_rate = number_photons;
                if (current_voltage < 80) continue;
                if (photon_waves.indexOf(photon_wave) % (skip_rate + 1) !== 0) continue;

                photon_wave_param.time += 2.0*delta_time;
                let direction = vec3_normalize([Math.sin(photon_wave.angle), Math.cos(photon_wave.angle), 0]);
                let speed = 0.4;
                let translation = vec3_scale(direction, speed * delta_time);
                photon_wave.transform = mat4_mat4_mul(translate_3d(translation), photon_wave.transform);

                let dx = photon_wave.transform[12] - zoom_circle_pos[0];
                let dy = photon_wave.transform[13] - zoom_circle_pos[1];
                let distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > zoom_circle_radius && dy > 0) {
                    let random_angle = rad(85 + Math.random() * 20);
                    let random_pos;
                    let overlap;
                    do {
                        overlap = false;
                        random_pos = [
                            zoom_circle_pos[0] + (Math.random() - 0.5) * zoom_circle_radius * 2,
                            zoom_circle_pos[1] + (Math.random() - 0.5) * 0.4 - 0.4,
                            zoom_circle_pos[2]
                        ];
                        for (let j = 0; j < photon_waves.length; j++) {
                            let dx = random_pos[0] - photon_waves[j].transform[12];
                            let dy = random_pos[1] - photon_waves[j].transform[13];
                            let distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance < 0.2) {
                                overlap = true;
                                break;
                            }
                        }
                    } while (overlap);
                    photon_wave.transform = mat4_mat4_mul(
                        rotate_3d(axis_angle_to_quat([0, 0, 1], random_angle)),
                        translate_3d(random_pos),
                    );
                    photon_wave.angle = random_angle;
                }

                ctx.update_wave_3d(photon_wave, photon_wave_param, lines_segments_3d);
                ctx.draw(photon_wave, {}, ui_camera);
            }

            gl.stencilFunc(gl.EQUAL, 0, 0xFF);
            ctx.draw(zoom_circle, {"metallic": 0}, ui_camera);
            ctx.draw(zoom_line_1, {"metallic": 0}, ui_camera);
            ctx.draw(zoom_line_2, {"metallic": 0}, ui_camera);

            gl.disable(gl.STENCIL_TEST);

            gl.depthFunc(gl.ALWAYS);

            ctx.gl.bindFramebuffer(ctx.gl.FRAMEBUFFER, postprocess_framebuffer);
            gl.clearColor(0, 0, 0, 0);
            gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            ctx.draw(bulb, {"color": [1.000, 0.577, 0.000], "m": bulb_transform}, null, "shader_basic");
            ctx.gl.bindFramebuffer(ctx.gl.FRAMEBUFFER, null);

            gl.useProgram(ctx.shaders["shader_postprocess"].program);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, postprocess_texture);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.uniform1i(ctx.shaders["shader_postprocess"].uniforms["framebuffer_texture"].location, 1);
            const u_min = left / gl.canvas.width;
            const v_min = bottom / gl.canvas.height;
            const u_max = (left + width) / gl.canvas.width;
            const v_max = (bottom + height) / gl.canvas.height;
            gl.uniform4f(ctx.shaders["shader_postprocess"].uniforms["scissor_texcoords"].location, u_min, v_min, u_max, v_max);

            gl.bindVertexArray(fullscreen_quad.vertex_buffer.vao);
            ctx.set_shader_uniform(ctx.shaders["shader_postprocess"], "p", mat4_identity());
            ctx.set_shader_uniform(ctx.shaders["shader_postprocess"], "v", mat4_identity());
            current_brightness = remap_value(current_voltage, 0, 220, 0, 0.2);
            ctx.set_shader_uniform(ctx.shaders["shader_postprocess"], "brightness", current_brightness);
            gl.drawElements(gl.TRIANGLES, fullscreen_quad.vertex_buffer.draw_count, gl.UNSIGNED_SHORT, 0);
        }
        else if(scene_id == "scene_relativity"){
            if(scene.set_charges_spacing >= 0){
                if(scene.set_charges_spacing == 2){
                    scene.spacing_positive = 0.14;
                    scene.spacing_negative = 0.45;
                }
                else{
                    scene.spacing_positive = 0.28;
                    scene.spacing_negative = 0.28;
                }

                let counter = 0;
                for(let i = 0; i < scene.charges.length; i++){
                    if(scene.charges[i].id === big_charge_id){
                        continue;
                    }
                    if(scene.charges[i].id.includes("positive")){
                        continue;
                    }
                    let start_pos = counter*scene.spacing_negative - (scene.num_charges-1)/2*scene.spacing_negative;
                    charge_pos = [start_pos, scene.cable_y_pos-0.28, 0];
                    scene.charges[i].pos = charge_pos;
                    scene.charges[i].start_pos = start_pos;
                    counter++;
                }

                counter = 0;
                for(let i = 0; i < scene.charges.length; i++){
                    if(scene.charges[i].id == big_charge_id){
                        continue;
                    }
                    if(scene.charges[i].id.includes("negative")){
                        continue;
                    }
                    let start_pos = counter*scene.spacing_positive - (scene.num_charges-1)/2*scene.spacing_positive;
                    charge_pos = [start_pos, scene.cable_y_pos, 0];
                    scene.charges[i].pos = charge_pos;
                    scene.charges[i].start_pos = start_pos;
                    counter++;
                }

                scene.set_charges_spacing = -1;
            }

            let stuff_speed = 0.72*2; // this needs to be a multiple of 2 (?) for some reason
            let speed = stuff_speed*delta_time;
            for(const charge of scene.charges){
                ctx.draw(charge.sign);
                ctx.draw(charge.charge);
                ctx.draw(charge.charge_background);
                ctx.draw(charge.arrow);

                if(charge.id == big_charge_id) continue;

                if(scene.reference_frame == 0){
                    if(charge.type != "positive"){
                        charge.pos[0] += speed;
                    }
                }
                else if(scene.reference_frame >= 1){
                    if(charge.type != "negative"){
                        charge.pos[0] -= speed;
                    }
                }

                let spacing = charge.type == "negative" ? scene.spacing_negative : scene.spacing_positive;
                if(Math.abs(charge.pos[0]-charge.start_pos) > spacing){
                    charge.pos[0] = charge.start_pos;
                }
                update_charge_pos(charge);
            }

            if(scene.reference_frame == 0){
                big_charge.pos[0] += speed;
                if(big_charge.pos[0]-big_charge.start_pos > Math.abs(big_charge.start_pos)*2){
                    big_charge.pos[0] = big_charge.start_pos;
                }
            }
            else{
                big_charge.pos[0] = 0;
            }

            update_charge_pos(big_charge);

            update_drag_charges_relativity(ctx.scenes["scene_relativity"]);

            ctx.draw(cable);

            for(let i = 0; i < random_circles.length; i++){
                if(scene.reference_frame > 0){
                        random_circles_pos[i][0] -= stuff_speed*delta_time;
                        if(random_circles_pos[i][0] < -3.5){
                            random_circles_pos[i][0] = 3.5;
                        }
                }
                random_circles[i].transform = translate_3d(random_circles_pos[i]);
                ctx.draw(random_circles[i]);
            }
        }
    }

    requestAnimationFrame(update);
}
requestAnimationFrame(update);

const sliders = document.querySelectorAll("input[type='range']");

function update_slider_background(slider) {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const value = parseFloat(slider.value);
    const percentage = ((value - min) / (max - min)) * 100;
    const color = slider.getAttribute("data-color") || "#555";

    slider.style.background = `linear-gradient(to right, ${color} ${percentage}%, #ddd ${percentage}%)`;
    slider.style.setProperty("--thumb-color", color);
}

sliders.forEach(slider => {
    update_slider_background(slider);
    slider.addEventListener("input", () => update_slider_background(slider));
});

const buttons_reference = document.querySelectorAll(".button-reference");
const buttons_reference_inline = document.querySelectorAll(".button-reference-inline");
buttons_reference.forEach(button => {
    button.addEventListener("click", () => {
        let scene = ctx.scenes["scene_relativity"];
        scene.reference_frame = parseInt(button.getAttribute("data-reference"));
        scene.set_charges_spacing = scene.reference_frame;
        buttons_reference.forEach(b => b.classList.remove("active"));
        button.classList.add("active");
        buttons_reference_inline.forEach(b => b.classList.remove("active"));
        for(let other_button of buttons_reference_inline){
            if(other_button.getAttribute("data-reference") == button.getAttribute("data-reference")){
                other_button.classList.add("active");
            }
        }
    });
});
buttons_reference_inline.forEach(button => {
    button.addEventListener("click", () => {
        let scene = ctx.scenes["scene_relativity"];
        scene.reference_frame = parseInt(button.getAttribute("data-reference"));
        scene.set_charges_spacing = scene.reference_frame;
        buttons_reference_inline.forEach(b => b.classList.remove("active"));
        button.classList.add("active");
        buttons_reference.forEach(b => b.classList.remove("active"));
        for(let other_button of buttons_reference){
            if(other_button.getAttribute("data-reference") == button.getAttribute("data-reference")){
                other_button.classList.add("active");
            }
        }
    });
});

function get_uint32(data_view, offset, little_endian = true) {
    return data_view.getUint32(offset, little_endian);
}

function get_uint64(data_view, offset, little_endian = true) {
    let low = data_view.getUint32(offset, little_endian);
    let high = data_view.getUint32(offset + 4, little_endian);
    return little_endian ? high * 2 ** 32 + low : low * 2 ** 32 + high;
}

function get_string(data_view, offset, size) {
    let bytes = new Uint8Array(data_view.buffer, offset, size);
    return new TextDecoder().decode(bytes);
}

function get_uint32_buffer(data_view, offset, size, little_endian = true) {
    let uints = [];
    for (let i = 0; i < size; i += 4) {
        uints.push(data_view.getUint32(offset + i, little_endian));
    }
    return uints;
}

function get_float_buffer(data_view, offset, size, little_endian = true) {
    let floats = [];
    for (let i = 0; i < size; i += 4) {
        floats.push(data_view.getFloat32(offset + i, little_endian));
    }
    return floats;
}

async function get_mesh_from_file(zip_data, path) {
    try {
        let data = zip_data[path];
        let view = new DataView(data);
        let ptr = 0;
        const name_size = get_uint64(view, ptr);
        ptr += 8;
        ptr += name_size;
        const num_attribs = get_uint64(view, ptr);
        ptr += 8;
        let attribs = [];
        for(let i = 0; i < num_attribs; i++){
            const attrib_name_size = get_uint64(view, ptr);
            ptr += 8;
            const attrib_name = get_string(view, ptr, attrib_name_size);
            ptr += attrib_name_size;
            const attrib_size = get_uint32(view, ptr);
            ptr += 4;
            attribs.push({name: attrib_name, size: attrib_size});
        }

        const vertices_size = get_uint64(view, ptr);
        ptr += 8;
        const vertices = get_float_buffer(view, ptr, vertices_size * 4);
        ptr += vertices_size * 4;

        const indices_size = get_uint64(view, ptr);
        ptr += 8;
        const indices = get_uint32_buffer(view, ptr, indices_size * 4);
        ptr += indices_size * 4;
        return { vertices: vertices, indices: indices, attribs: attribs };
    } catch (err) {
        console.error(err);
    }
};
const meshes = [
    { path: "led_metal.mesh", drawable: led_metal },
    { path: "led_epoxy_case.mesh", drawable: led_epoxy_case },
    { path: "led_reflective_case.mesh", drawable: led_reflective_case },
    { path: "bulb.mesh", drawable: bulb },
    { path: "bulb2.mesh", drawable: bulb2 },
    { path: "bulb_screw.mesh", drawable: bulb_screw },
    { path: "bulb_screw_black.mesh", drawable: bulb_screw_black },
    { path: "bulb_wire.mesh", drawable: bulb_wire },
    { path: "bulb_wire_holder.mesh", drawable: bulb_wire_holder },
    { path: "apple.mesh", drawable: apple },
    { path: "apple_stem.mesh", drawable: apple_stem },
    { path: "apple_leaf.mesh", drawable: apple_leaf },
    { path: "coil.mesh", drawable: coil },
    { path: "voltmeter.mesh", drawable: voltmeter },
    { path: "voltmeter_screen.mesh", drawable: voltmeter_screen },
    { path: "voltmeter_arrow.mesh", drawable: voltmeter_arrow },
    { path: "coil_ampere.mesh", drawable: coil_ampere },
    { path: "battery.mesh", drawable: battery1 },
    { path: "battery.mesh", drawable: battery2 },
    { path: "battery.mesh", drawable: battery_cap1 },
    { path: "battery.mesh", drawable: battery_cap2 },
    { path: "magnet.mesh", drawable: magnet },
    { path: "magnet_arrow.mesh", drawable: magnet_arrow1 },
    { path: "magnet_arrow.mesh", drawable: magnet_arrow2 },
    { path: "sun_surface.mesh", drawable: sun_surface },
    { path: "sun_cross.mesh", drawable: sun_cross },
    { path: "flashlight.mesh", drawable: flashlight },
    { path: "flashlight_inside.mesh", drawable: flashlight_inside },
    { path: "flashlight_light.mesh", drawable: flashlight_light },
    { path: "flashlight_inside.mesh", drawable: flashlight_inside_m },
    { path: "flashlight_light.mesh", drawable: flashlight_light_m },
    { path: "banana.mesh", drawable: banana },
    { path: "banana_head.mesh", drawable: banana_head },
];

let zip_data = {};

async function load_meshes_from_zip(zip_path) {
    const res = await fetch(zip_path);
    const blob = await res.blob();
    const zip = await JSZip.loadAsync(blob);

    const load_promises = [];

    zip.forEach((relative_path, file) => {
        if (relative_path.endsWith(".mesh")) {
            const promise = file.async("arraybuffer").then(buffer => {
                zip_data[relative_path] = buffer;
            });
            load_promises.push(promise);
        }
    });

    await Promise.all(load_promises);
}

(async () => {
    await load_meshes_from_zip("meshes.zip");

     for (let mesh of meshes) {
        const data = await get_mesh_from_file(zip_data, mesh.path);
        if (data) {
            mesh.drawable.vertex_buffer = ctx.create_vertex_buffer(data.vertices, data.attribs, data.indices);
        }
    }
})();

async function get_texture(ctx, url){
    const gl = ctx.gl;
    try {
        let res = await fetch(url);
        let blob = await res.blob();
        let texture = gl.createTexture();

        if(url.endsWith(".hdr")){
            let array_buffer = await blob.arrayBuffer();
            let hdr = await parse_hdr(array_buffer);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, hdr.width, hdr.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, hdr.data);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
        }
        else{
            let image = await createImageBitmap(blob);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
        }

        return texture;
    } catch (err) {
        console.error(err);
    }
};

for(let texture of Object.values(textures)){
    get_texture(ctx, texture.path).then(data => {
        texture.texture = data;
    });
}

function parse_hdr(array_buffer) {
    const data = new Uint8Array(array_buffer);
    let pos = 0;

    let header = '';
    while (pos < data.length) {
        const char = String.fromCharCode(data[pos++]);
        header += char;
        if (header.endsWith('\n\n')) break;
    }

    let line = '';
    while (pos < data.length) {
        const char = String.fromCharCode(data[pos++]);
        if (char === '\n') break;
        line += char;
    }

    const match = line.match(/-Y (\d+) \+X (\d+)/);
    if (!match) throw new Error('Invalid HDR format');

    const height = parseInt(match[1]);
    const width = parseInt(match[2]);

    const rgba_data = new Uint8Array(width * height * 4);
    let out_pos = 0;

    for (let y = 0; y < height; y++) {
        if (data[pos] === 2 && data[pos + 1] === 2) {
            pos += 4;

            const scanline = new Uint8Array(width * 4);
            for (let channel = 0; channel < 4; channel++) {
                let x = 0;
                while (x < width) {
                    let code = data[pos++];
                    if (code > 128) {
                        const count = code - 128;
                        const value = data[pos++];
                        for (let i = 0; i < count; i++) {
                            scanline[x * 4 + channel] = value;
                            x++;
                        }
                    } else {
                        const count = code;
                        for (let i = 0; i < count; i++) {
                            scanline[x * 4 + channel] = data[pos++];
                            x++;
                        }
                    }
                }
            }

            for (let x = 0; x < width; x++) {
                const r = scanline[x * 4];
                const g = scanline[x * 4 + 1];
                const b = scanline[x * 4 + 2];
                const e = scanline[x * 4 + 3];

                if (e === 0) {
                    rgba_data[out_pos++] = 0;
                    rgba_data[out_pos++] = 0;
                    rgba_data[out_pos++] = 0;
                    rgba_data[out_pos++] = 255;
                } else {
                    const f = Math.pow(2, e - 128) / 255;
                    rgba_data[out_pos++] = Math.min(255, Math.floor(r * f * 255));
                    rgba_data[out_pos++] = Math.min(255, Math.floor(g * f * 255));
                    rgba_data[out_pos++] = Math.min(255, Math.floor(b * f * 255));
                    rgba_data[out_pos++] = 255;
                }
            }
        } else {
            for (let x = 0; x < width; x++) {
                const r = data[pos++];
                const g = data[pos++];
                const b = data[pos++];
                const e = data[pos++];

                if (e === 0) {
                    rgba_data[out_pos++] = 0;
                    rgba_data[out_pos++] = 0;
                    rgba_data[out_pos++] = 0;
                    rgba_data[out_pos++] = 255;
                } else {
                    const f = Math.pow(2, e - 128) / 255;
                    rgba_data[out_pos++] = Math.min(255, Math.floor(r * f * 255));
                    rgba_data[out_pos++] = Math.min(255, Math.floor(g * f * 255));
                    rgba_data[out_pos++] = Math.min(255, Math.floor(b * f * 255));
                    rgba_data[out_pos++] = 255;
                }
            }
        }
    }

    return { data: rgba_data, width, height };
}

async function create_envmap_texture(ctx, files, file_names) {
    const gl = ctx.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, file_names.length - 1);

    for (let level = 0; level < file_names.length; level++) {
        const file = files.find(f => f.name === file_names[level]);
        const array_buffer = await file.async("arraybuffer");
        const { data, width, height } = parse_hdr(array_buffer);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    return texture;
}

(async () => {
    for (let name in envmaps) {
        const envmap = envmaps[name];
        envmap.name = name;
        envmap.files = [];
        envmap.specular_texture = null;
        envmap.diffuse_texture = null;

        const res = await fetch(envmap.path);
        const blob = await res.blob();
        const zip = await JSZip.loadAsync(blob);

        zip.forEach((relative_path, file) => {
            envmap.files.push(file);
        });

        const mipmap_names = [];
        for (let i = 0; i < 10; i++) {
            const filename = `m${i}.hdr`;
            if (envmap.files.find(f => f.name === filename)) {
                mipmap_names.push(filename);
            } else {
                break;
            }
        }

        envmap.specular_texture = await create_envmap_texture(ctx, envmap.files, mipmap_names);
        envmap.diffuse_texture = await create_envmap_texture(ctx, envmap.files, ['irradiance.hdr']);
    }
})();

function parse_fnt(fnt_text) {
    const lines = fnt_text.split("\n").map(line => line.trim()).filter(line => line);
    const font_data = {
        info: {},
        common: {},
        pages: [],
        chars: [],
        kernings: []
    };
    const key_value_regex = /(\w+)="?([^"\s]+)"?(?=\s|$)|(\w+)=(-?\d+)/g;

    lines.forEach(line => {
        const parts = line.split(/\s+/);
        const type = parts[0];

        switch(type) {
            case "info":
            case "common": {
                const obj = {};
                let match;
                while ((match = key_value_regex.exec(line)) !== null) {
                    const key = match[1] || match[3];
                    const value = match[2] || match[4];
                    obj[key] = isNaN(value) ? value : parseInt(value);
                }
                font_data[type] = obj;
                break;
            }
            case "page": {
                const page = {};
                let match;
                while ((match = key_value_regex.exec(line)) !== null) {
                    const key = match[1] || match[3];
                    const value = match[2] || match[4];
                    page[key] = key === "file" ? value.replace(/"/g, "") : parseInt(value);
                }
                font_data.pages.push(page.file);
                break;
            }
            case "char": {
                const char = {};
                let match;
                while ((match = key_value_regex.exec(line)) !== null) {
                    const key = match[1] || match[3];
                    const value = match[2] || match[4];
                    char[key] = isNaN(value) ? value : parseInt(value);
                }
                char.char = String.fromCharCode(char.id);
                font_data.chars.push(char);
                break;
            }
            case "kerning": {
                const kerning = {};
                let match;
                while ((match = key_value_regex.exec(line)) !== null) {
                    const key = match[1] || match[3];
                    const value = match[2] || match[4];
                    kerning[key] = parseInt(value);
                }
                font_data.kernings.push(kerning);
                break;
            }
        }
    });

    return font_data;
}

async function get_font(ctx, fnt_path, bitmap_path) {
    const gl = ctx.gl;
    try {
        let res = await fetch(fnt_path);
        let fnt_data = await res.text();
        res = await fetch(bitmap_path);
        let bitmap_data = await res.arrayBuffer();

        const image = new Image();
        image.src = bitmap_path;

        await new Promise((resolve, reject) => {
            image.onload = () => {
                gl.bindTexture(gl.TEXTURE_2D, ctx.font_texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.generateMipmap(gl.TEXTURE_2D);
                resolve();
            };
            image.onerror = reject;
        });


        const font_data = parse_fnt(fnt_data);

        ctx.font = { chars: {} };
        font_data.chars.forEach(char => {
            ctx.font.chars[char.char] = char;
        });

        ctx.font.data = {
            scale_w: font_data.common.scaleW,
            scale_h: font_data.common.scaleH,
            line_height: font_data.common.lineHeight,
            base: font_data.common.base
        };

        let custom_vertex_attribs = [
            { name: "position_attrib", size: 2 },
            { name: "texcoord_attrib", size: 2 }
        ];

        for(let key in ctx.text_buffers){
            ctx.text_buffers[key] = ctx.create_drawable("shader_text", create_text_buffer(ctx, ctx.text_buffers[key].text, 0, 0, ctx.text_buffers[key].centered), ctx.text_buffers[key].color,
                ctx.text_buffers[key].transform, custom_vertex_attribs);
        }
    } catch (err) {
        console.error(err);
    }
};

get_font(ctx, "inter.fnt", "inter.png");

(function() {
    const thresholds_id = ["circle-ray", "circle-wave", "circle-electromagnetic", "circle-quantum"];
    const thresholds = [1, 3, 5, 7];

    const items = Array.from(
        document.querySelectorAll(".circle-right li")
    );

    document.querySelectorAll(".circle").forEach(circle => {
        function thingy(e){
            if (e.target !== e.currentTarget) return;

            const prev = document.querySelector(".selected-circle");
            if (prev) prev.classList.remove("selected-circle");
            circle.classList.add("selected-circle");

            const threshold = thresholds[thresholds_id.indexOf(circle.id)];
            const threshold_prev = thresholds[thresholds_id.indexOf(circle.id)-1] || 0;

            items.forEach(li => {
                const idx = parseInt(li.id.split("-")[1], 10);
                const was_grayed = li.classList.contains("grayed");
                if (idx <= threshold) {
                    if(idx > threshold_prev){
                        li.classList.add("highlighted");
                    }
                    else{
                        li.classList.remove("highlighted");
                    }
                    li.classList.remove("grayed");
                } else {
                    li.classList.add("grayed");
                    li.classList.remove("highlighted");
                }
            });
        }

        circle.addEventListener("mouseover", (e) => {
            thingy(e);
        });
        circle.addEventListener("touchstart", (e) => {
            thingy(e);
        });
    });
})();
