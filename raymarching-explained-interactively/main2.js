let ctx = {};


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
            
            let nx = sin_theta * cos_phi;
            let ny = cos_theta;
            let nz = sin_theta * sin_phi;
            
            vertices.push(x, y, z, nx, ny, nz);
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
                
                let v1 = { x: vertices[first * 8], y: vertices[first * 8 + 1], z: vertices[first * 8 + 2] };
                let v2 = { x: vertices[second * 8], y: vertices[second * 8 + 1], z: vertices[second * 8 + 2] };
                let v3 = { x: vertices[third * 8], y: vertices[third * 8 + 1], z: vertices[third * 8 + 2] };
                let v4 = { x: vertices[fourth * 8], y: vertices[fourth * 8 + 1], z: vertices[fourth * 8 + 2] };
                
                let normal1 = calculate_normal(v1.x, v1.y, v1.z, v3.x, v3.y, v3.z, v2.x, v2.y, v2.z);
                
                flat_vertices.push(
                    v1.x, v1.y, v1.z, normal1.x, normal1.y, normal1.z,
                    v3.x, v3.y, v3.z, normal1.x, normal1.y, normal1.z,
                    v2.x, v2.y, v2.z, normal1.x, normal1.y, normal1.z
                );
                
                let normal2 = calculate_normal(v2.x, v2.y, v2.z, v3.x, v3.y, v3.z, v4.x, v4.y, v4.z);
                
                flat_vertices.push(
                    v2.x, v2.y, v2.z, normal2.x, normal2.y, normal2.z,
                    v3.x, v3.y, v3.z, normal2.x, normal2.y, normal2.z,
                    v4.x, v4.y, v4.z, normal2.x, normal2.y, normal2.z
                );
            }
        }
        
        vertices = flat_vertices;
        for (let i = 0; i < vertices.length / 8; i++) {
            indices.push(i);
        }
    }
    
    return { vertices, indices };
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


ctx.canvas = document.getElementById("main-canvas");
ctx.gl = ctx.canvas.getContext("webgl2", {stencil: true});
ctx.font_texture = ctx.gl.createTexture();
ctx.font = {chars:{}, data: {}};
ctx.text_buffers = {};
ctx.drawables = [];

ctx.scenes = {
    "scene_3d_viz": {id: "scene_3d_viz", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                pivot: [ 2, 0, 0 ],
                rotation: [ -0.27777175009252497, -0.7967021604366459, 0 ],
                zoom: 6.0
            }
        }
    }
};

ctx.update_drawable_mesh = function(drawable, mesh){
    const gl = this.gl;
    if(drawable.vertex_buffer != null){
        gl.deleteVertexArray(drawable.vertex_buffer.vao);
        gl.deleteBuffer(drawable.vertex_buffer.vbo);
        gl.deleteBuffer(drawable.vertex_buffer.ebo);
    }
    drawable.vertex_buffer = this.create_vertex_buffer(mesh.vertices, [
                            { name: 'position_attrib', size: 3 },
                            { name: 'normal_attrib', size: 3 }
                        ], mesh.indices);
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
    frag_color = vec4(0, 0, 0, font.a > 0.5 ? font.a : 0.0);
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
    
    out vec4 frag_color;
    
    in vec3 position;
    in vec3 normal;
    
    void main(){
        frag_color = vec4(color, 1);
    }`);
ctx.shaders["shader_uv"] = ctx.create_shader(`#version 300 es
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
    frag_color = vec4(normal.yz, 0, 1);
}`);
ctx.shaders["shader_shaded"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;

void main(){
    vec4 world_pos = m*vec4(position_attrib, 1);
    gl_Position = p*v*world_pos;
    position = world_pos.xyz;
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
    vec3 light_dir = normalize(vec3(0, 5, 1) - position);
    float diffuse = max(dot(normalize(normal), light_dir), 0.0) + 0.2;
    frag_color = vec4(color*diffuse, 1.0);
}`);


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
        scene.dragging_rect = null;
        scene.is_dragging = false;
        scene.last_pos = null;
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
                    const rect = scene.draggable_rects[rect_id];
                    if (rect_id == "scene" || coords.x >= rect[0] && coords.x <= rect[2] &&
                        coords.y >= rect[1] && coords.y <= rect[3]) {
                        hovered = true;
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
                    const rect = scene.draggable_rects[rect_id];
                    if (rect_id == "scene" || coords.x >= rect[0] && coords.x <= rect[2] &&
                        coords.y >= rect[1] && coords.y <= rect[3]) {
                        scene.dragging_rect = rect_id;
                        scene.is_dragging = true;
                        scene.last_pos = [coords.x, coords.y];
                        break;
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

ctx.create_drawable = function(shader, mesh, color, transform, custom_vertex_attribs){
    let drawable = {
        shader: shader,
        vertex_buffer : mesh == null ? null : this.create_vertex_buffer(mesh.vertices, custom_vertex_attribs == null ? [
                            { name: 'position_attrib', size: 3 },
                            { name: 'normal_attrib', size: 3 }
                        ] : custom_vertex_attribs, mesh.indices),
        color: color,
        transform: transform
    };
    this.drawables.push(drawable);
    return drawable;
}

function resize_event(ctx){
    ctx.gl.canvas.width = window.innerWidth;
    ctx.gl.canvas.height = window.innerHeight;

    let width = document.body.clientWidth - parseInt(window.getComputedStyle(document.body).paddingLeft) - parseInt(window.getComputedStyle(document.body).paddingRight);

    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        scene.el = document.getElementById(scene_id);
        let height = width/scene.ratio;
        scene.el.style.width = width + "px";
        scene.el.style.height = height + "px";
        scene.width = width;
        scene.height = height;
    }
    setup_scene_listeners();

}
resize_event(ctx);
addEventListener("resize", () => resize_event(ctx));

let camera_origin = [0, 0, 0];
let fov = 60;
let near_plane = 1;

let aspect_ratio = 1;

let green = [0.161, 0.776, 0.263];
let line_thickness = 0.019;
let line_thickness2 = 0.02;

let frustum_line_1 = ctx.create_drawable("shader_basic", null, green, mat4_identity());
let frustum_line_2 = ctx.create_drawable("shader_basic", null, green, mat4_identity());
let frustum_line_3 = ctx.create_drawable("shader_basic", null, green, mat4_identity());
let frustum_line_4 = ctx.create_drawable("shader_basic", null, green, mat4_identity());
let frustum_line_1_2 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_2_2 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_3_2 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_4_2 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_5 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_6 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_7 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let frustum_line_8 = ctx.create_drawable("shader_basic", null, [0, 0, 0], mat4_identity());
let near_plane_rect = ctx.create_drawable("shader_uv", null, [0, 0, 0], mat4_identity());

let origin_point = ctx.create_drawable("shader_basic", create_uv_sphere(1, 32, 32), green, 
mat4_mat4_mul(
    scale_3d([0.08, 0.08, 0.08]),
    translate_3d(camera_origin),
)
);

let sphere_position = [3.5, 0, 0];
let sphere_radius = 1;
let sphere = ctx.create_drawable("shader_shaded", create_uv_sphere(1, 32, 32), [1, 0, 0], 
mat4_mat4_mul(
    scale_3d([sphere_radius, sphere_radius, sphere_radius]),
    translate_3d([3.5, 0, 0]),
)
);

let rays = [];
let rays_circles = [];

function delete_drawable(drawable){
    const gl = ctx.gl;
    if(drawable.vertex_buffer == null) return;
    gl.deleteVertexArray(drawable.vertex_buffer.vao);
    gl.deleteBuffer(drawable.vertex_buffer.vbo);
    gl.deleteBuffer(drawable.vertex_buffer.ebo);
}

function point_sphere_dist(point, sphere_pos, sphere_radius){
    let dir = vec3_normalize(vec3_sub(point, sphere_pos));
    let closest_point = vec3_add(sphere_pos, vec3_scale(dir, sphere_radius));
    return [closest_point, distance(sphere_pos, point)-sphere_radius];
}

function update_frustum(ctx){
    near_plane = parseFloat(document.getElementById("near-plan-3d").value);
    fov = parseFloat(document.getElementById("fov-3d").value);
    nb_rays = parseInt(document.getElementById("nb-rays-3d").value);
    nb_iterations = parseInt(document.getElementById("iterations-3d").value);

    let frustum_line_length = near_plane+3;
    let near_height = 2 * Math.tan((fov / 2) * (Math.PI / 180)) * near_plane;
    let near_width = near_height * aspect_ratio;

    let frustum_corner_1 = [
        camera_origin[0] + near_plane,
        camera_origin[1] + near_width / 2,
        camera_origin[2] + near_height / 2
    ];
    
    let frustum_corner_2 = [
        camera_origin[0] + near_plane,
        camera_origin[1] - near_width / 2,
        camera_origin[2] + near_height / 2
    ];
    
    let frustum_corner_3 = [
        camera_origin[0] + near_plane,
        camera_origin[1] + near_width / 2,
        camera_origin[2] - near_height / 2
    ];
    
    let frustum_corner_4 = [
        camera_origin[0] + near_plane,
        camera_origin[1] - near_width / 2,
        camera_origin[2] - near_height / 2
    ];
    
    let frustum_center = [
        (frustum_corner_1[0] + frustum_corner_2[0] + frustum_corner_3[0] + frustum_corner_4[0]) / 4 - near_plane/2,
        (frustum_corner_1[1] + frustum_corner_2[1] + frustum_corner_3[1] + frustum_corner_4[1]) / 4 - near_height/2,
        (frustum_corner_1[2] + frustum_corner_2[2] + frustum_corner_3[2] + frustum_corner_4[2]) / 4
    ];
    
    let frustum_corner_1_2 = vec3_scale(vec3_normalize(vec3_sub(frustum_corner_1, camera_origin)), frustum_line_length);
    let frustum_corner_2_2 = vec3_scale(vec3_normalize(vec3_sub(frustum_corner_2, camera_origin)), frustum_line_length);
    let frustum_corner_3_2 = vec3_scale(vec3_normalize(vec3_sub(frustum_corner_3, camera_origin)), frustum_line_length);
    let frustum_corner_4_2 = vec3_scale(vec3_normalize(vec3_sub(frustum_corner_4, camera_origin)), frustum_line_length);

    ctx.update_drawable_mesh(frustum_line_1, create_line_3d([camera_origin, frustum_corner_1], line_thickness2, 32));
    ctx.update_drawable_mesh(frustum_line_2, create_line_3d([camera_origin, frustum_corner_2], line_thickness2, 32));
    ctx.update_drawable_mesh(frustum_line_3, create_line_3d([camera_origin, frustum_corner_3], line_thickness2, 32));
    ctx.update_drawable_mesh(frustum_line_4, create_line_3d([camera_origin, frustum_corner_4], line_thickness2, 32));
    ctx.update_drawable_mesh(frustum_line_1_2, create_line_3d([camera_origin, frustum_corner_1_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_2_2, create_line_3d([camera_origin, frustum_corner_2_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_3_2, create_line_3d([camera_origin, frustum_corner_3_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_4_2, create_line_3d([camera_origin, frustum_corner_4_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_5, create_line_3d([frustum_corner_1_2, frustum_corner_2_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_6, create_line_3d([frustum_corner_2_2, frustum_corner_4_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_7, create_line_3d([frustum_corner_3_2, frustum_corner_1_2], line_thickness, 32));
    ctx.update_drawable_mesh(frustum_line_8, create_line_3d([frustum_corner_3_2, frustum_corner_4_2], line_thickness, 32));

    ctx.update_drawable_mesh(near_plane_rect, create_rect([-near_width/2, -near_height/2, 0], [near_width, near_height]));
    near_plane_rect.transform = mat4_mat4_mul(
        translate_3d([0, 0, near_plane]),
        rotate_3d(axis_angle_to_quat(vec3_normalize([0, 1, 0]), rad(90))),
    );
    origin_point.transform = mat4_mat4_mul(
        scale_3d([0.08, 0.08, 0.08]),
        translate_3d(camera_origin),
    );
    let nb_rays_x = nb_rays;
    let nb_rays_y = nb_rays;

    for(let i = 0; i < rays.length; i++){
        delete_drawable(rays[i]);
    }
    for(let i = 0; i < rays_circles.length; i++){
        delete_drawable(rays_circles[i]);
    }

    rays = [];
    rays_circles = [];

    for(let i = 0; i < nb_rays_x; i++){
        for(let j = 0; j < nb_rays_y; j++){
            let ray_to = [
                camera_origin[0] + near_plane,
                -near_width/2  + (i + 0.5) * (near_width / nb_rays_x),
                -near_height/2 + (j + 0.5) * (near_height / nb_rays_y),
            ]

            let ray_dir = vec3_normalize(vec3_sub(ray_to, camera_origin));

            let ray = create_line_3d([camera_origin, ray_to], 0.01, 32);
            rays.push(ctx.create_drawable("shader_basic", ray, [0, 0, 0], mat4_identity()));

            let current_point = ray_to;
            for(let t = 0; t < nb_iterations; t++){
                let [closest_point, dist] = point_sphere_dist(current_point, sphere_position, sphere_radius);
                let new_point = vec3_add(current_point, vec3_scale(ray_dir, dist));
                rays_circles.push(ctx.create_drawable("shader_basic", create_uv_sphere(1, 32, 32), [0, 0, 0], 
                mat4_mat4_mul(
                    scale_3d([0.05, 0.05, 0.05]),
                    translate_3d(new_point),
                )
                ));
            
                ray = create_line_3d([current_point, new_point], 0.01, 32);
                current_point = new_point;

                rays.push(ctx.create_drawable("shader_basic", ray, [0, 0, 0], mat4_identity()));
            }
        }
    }
}

document.getElementById("fov-3d").value = fov;
document.getElementById("near-plan-3d").value = near_plane;
document.getElementById("nb-rays-3d").value = 4;
document.getElementById("iterations-3d").value = 4;

document.getElementById("near-plan-3d").oninput =
document.getElementById("fov-3d").oninput =
document.getElementById("nb-rays-3d").oninput =
document.getElementById("iterations-3d").oninput =
function(){
    update_frustum(ctx);
};
update_frustum(ctx);

ctx.time = 0.0;
ctx.last_time = 0.0;
function update(current_time){
    let delta_time = (current_time - ctx.last_time) / 1000;
    delta_time = Math.min(delta_time, 0.1);

    ctx.time += 0.01;

    const gl = ctx.gl;
    gl.canvas.style.transform = "translateY("+window.scrollY+"px)";
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for(let scene_id in ctx.scenes){
        const scene = ctx.scenes[scene_id];
        ctx.current_scene = scene;
        const rect = scene.el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top  > gl.canvas.clientHeight ||
            rect.right  < 0 || rect.left > gl.canvas.clientWidth) {
            continue;
        }

        const width  = rect.width;
        const height = rect.height;
        const left   = rect.left - gl.canvas.getBoundingClientRect().left;
        const bottom = gl.canvas.clientHeight - (rect.bottom - gl.canvas.getBoundingClientRect().top);

        gl.viewport(left, bottom, width, height);
        gl.scissor(left, bottom, width, height);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        if(scene_id == "scene_3d_viz"){
            ctx.draw(frustum_line_1);
            ctx.draw(frustum_line_2);
            ctx.draw(frustum_line_3);
            ctx.draw(frustum_line_4);
            ctx.draw(frustum_line_1_2);
            ctx.draw(frustum_line_2_2);
            ctx.draw(frustum_line_3_2);
            ctx.draw(frustum_line_4_2);
            ctx.draw(frustum_line_5);
            ctx.draw(frustum_line_6);
            ctx.draw(frustum_line_7);
            ctx.draw(frustum_line_8);
            ctx.draw(origin_point);
            ctx.draw(sphere);
            for(let i = 0; i < rays.length; i++){
                ctx.draw(rays[i]);
            }
            for(let i = 0; i < rays_circles.length; i++){
                ctx.draw(rays_circles[i]);
            }
            gl.disable(gl.CULL_FACE);
            ctx.draw(near_plane_rect);
        }
    }

    requestAnimationFrame(update);
}
requestAnimationFrame(update);