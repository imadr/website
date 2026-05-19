function mat3_mat3_add(a, b){
    return [
        a[0]+b[0], a[1]+b[1], a[2]+b[2],
        a[3]+b[3], a[4]+b[4], a[5]+b[5],
        a[6]+b[6], a[7]+b[7], a[8]+b[8]
    ];
}

function mat4_mat4_add(a, b){
    return [
        a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3],
        a[4]+b[4], a[5]+b[5], a[6]+b[6], a[7]+b[7],
        a[8]+b[8], a[9]+b[9], a[10]+b[10], a[11]+b[11],
        a[12]+b[12], a[13]+b[13], a[14]+b[14], a[15]+b[15]
    ];
}

function mat3_mat3_mul(a, b){
    return [
        a[0]*b[0]+a[1]*b[3]+a[2]*b[6],
        a[0]*b[1]+a[1]*b[4]+a[2]*b[7],
        a[0]*b[2]+a[1]*b[5]+a[2]*b[8],

        a[3]*b[0]+a[4]*b[3]+a[5]*b[6],
        a[3]*b[1]+a[4]*b[4]+a[5]*b[7],
        a[3]*b[2]+a[4]*b[5]+a[5]*b[8],

        a[6]*b[0]+a[7]*b[3]+a[8]*b[6],
        a[6]*b[1]+a[7]*b[4]+a[8]*b[7],
        a[6]*b[2]+a[7]*b[5]+a[8]*b[8]
    ];
}

function mat4_mat4_mul(a, b){
    return [
        a[0]*b[0]+a[1]*b[4]+a[2]*b[8]+a[3]*b[12],
        a[0]*b[1]+a[1]*b[5]+a[2]*b[9]+a[3]*b[13],
        a[0]*b[2]+a[1]*b[6]+a[2]*b[10]+a[3]*b[14],
        a[0]*b[3]+a[1]*b[7]+a[2]*b[11]+a[3]*b[15],

        a[4]*b[0]+a[5]*b[4]+a[6]*b[8]+a[7]*b[12],
        a[4]*b[1]+a[5]*b[5]+a[6]*b[9]+a[7]*b[13],
        a[4]*b[2]+a[5]*b[6]+a[6]*b[10]+a[7]*b[14],
        a[4]*b[3]+a[5]*b[7]+a[6]*b[11]+a[7]*b[15],

        a[8]*b[0]+a[9]*b[4]+a[10]*b[8]+a[11]*b[12],
        a[8]*b[1]+a[9]*b[5]+a[10]*b[9]+a[11]*b[13],
        a[8]*b[2]+a[9]*b[6]+a[10]*b[10]+a[11]*b[14],
        a[8]*b[3]+a[9]*b[7]+a[10]*b[11]+a[11]*b[15],

        a[12]*b[0]+a[13]*b[4]+a[14]*b[8]+a[15]*b[12],
        a[12]*b[1]+a[13]*b[5]+a[14]*b[9]+a[15]*b[13],
        a[12]*b[2]+a[13]*b[6]+a[14]*b[10]+a[15]*b[14],
        a[12]*b[3]+a[13]*b[7]+a[14]*b[11]+a[15]*b[15]
    ];
}

function mat3_vec3_mul(m, v){
    return [
        v[0]*m[0]+v[1]*m[1]+v[2]*m[2],
        v[0]*m[3]+v[1]*m[4]+v[2]*m[5],
        v[0]*m[6]+v[1]*m[7]+v[2]*m[8]
    ];
}

function mat4_vec4_mul(m, v){
    return [
        v[0]*m[0]+v[1]*m[1]+v[2]*m[2]+v[3]*m[3],
        v[0]*m[4]+v[1]*m[5]+v[2]*m[6]+v[3]*m[7],
        v[0]*m[8]+v[1]*m[9]+v[2]*m[10]+v[3]*m[11],
        v[0]*m[12]+v[1]*m[13]+v[2]*m[14]+v[3]*m[15]
    ];
}

function vec4_mat4_mul(v, m){
    return [
        v[0]*m[0]+v[1]*m[4]+v[2]*m[8]+v[3]*m[12],
        v[0]*m[1]+v[1]*m[5]+v[2]*m[9]+v[3]*m[13],
        v[0]*m[2]+v[1]*m[6]+v[2]*m[10]+v[3]*m[14],
        v[0]*m[3]+v[1]*m[7]+v[2]*m[11]+v[3]*m[15]
    ];
}

function mat3_identity(){
    return [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
    ];
}

function mat4_identity(){
    return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ];
}

function mat4_transpose(m){
    let t = mat4_identity();
    for(let i = 0; i < 16; i++){
        t[i] = m[(i%4*4)+Math.floor(i/4)];
    }
    return t;
}

function mat4_det(m){
    return m[3]*m[6]*m[9]*m[12] - m[2]*m[7]*m[9]*m[12] - m[3]*m[5]*m[10]*m[12] + m[1]*m[7]*m[10]*m[12]+
           m[2]*m[5]*m[11]*m[12] - m[1]*m[6]*m[11]*m[12] - m[3]*m[6]*m[8]*m[13] + m[2]*m[7]*m[8]*m[13]+
           m[3]*m[4]*m[10]*m[13] - m[0]*m[7]*m[10]*m[13] - m[2]*m[4]*m[11]*m[13] + m[0]*m[6]*m[11]*m[13]+
           m[3]*m[5]*m[8]*m[14] - m[1]*m[7]*m[8]*m[14] - m[3]*m[4]*m[9]*m[14] + m[0]*m[7]*m[9]*m[14]+
           m[1]*m[4]*m[11]*m[14] - m[0]*m[5]*m[11]*m[14] - m[2]*m[5]*m[8]*m[15] + m[1]*m[6]*m[8]*m[15]+
           m[2]*m[4]*m[9]*m[15] - m[0]*m[6]*m[9]*m[15] - m[1]*m[4]*m[10]*m[15] + m[0]*m[5]*m[10]*m[15];
}

function mat4_scale(m, s){
    return [s*m[0], s*m[1], s*m[2], s*m[3], s*m[4], s*m[5], s*m[6], s*m[7], s*m[8], s*m[9], s*m[10], s*m[11], s*m[12], s*m[13], s*m[14], s*m[15]];
}

function mat4_invert(m){
    let det = mat4_det(m);
    m = [
        m[6]*m[11]*m[13] - m[7]*m[10]*m[13] + m[7]*m[9]*m[14] - m[5]*m[11]*m[14] - m[6]*m[9]*m[15] + m[5]*m[10]*m[15],
        m[3]*m[10]*m[13] - m[2]*m[11]*m[13] - m[3]*m[9]*m[14] + m[1]*m[11]*m[14] + m[2]*m[9]*m[15] - m[1]*m[10]*m[15],
        m[2]*m[7]*m[13] - m[3]*m[6]*m[13] + m[3]*m[5]*m[14] - m[1]*m[7]*m[14] - m[2]*m[5]*m[15] + m[1]*m[6]*m[15],
        m[3]*m[6]*m[9] - m[2]*m[7]*m[9] - m[3]*m[5]*m[10] + m[1]*m[7]*m[10] + m[2]*m[5]*m[11] - m[1]*m[6]*m[11],
        m[7]*m[10]*m[12] - m[6]*m[11]*m[12] - m[7]*m[8]*m[14] + m[4]*m[11]*m[14] + m[6]*m[8]*m[15] - m[4]*m[10]*m[15],
        m[2]*m[11]*m[12] - m[3]*m[10]*m[12] + m[3]*m[8]*m[14] - m[0]*m[11]*m[14] - m[2]*m[8]*m[15] + m[0]*m[10]*m[15],
        m[3]*m[6]*m[12] - m[2]*m[7]*m[12] - m[3]*m[4]*m[14] + m[0]*m[7]*m[14] + m[2]*m[4]*m[15] - m[0]*m[6]*m[15],
        m[2]*m[7]*m[8] - m[3]*m[6]*m[8] + m[3]*m[4]*m[10] - m[0]*m[7]*m[10] - m[2]*m[4]*m[11] + m[0]*m[6]*m[11],
        m[5]*m[11]*m[12] - m[7]*m[9]*m[12] + m[7]*m[8]*m[13] - m[4]*m[11]*m[13] - m[5]*m[8]*m[15] + m[4]*m[9]*m[15],
        m[3]*m[9]*m[12] - m[1]*m[11]*m[12] - m[3]*m[8]*m[13] + m[0]*m[11]*m[13] + m[1]*m[8]*m[15] - m[0]*m[9]*m[15],
        m[1]*m[7]*m[12] - m[3]*m[5]*m[12] + m[3]*m[4]*m[13] - m[0]*m[7]*m[13] - m[1]*m[4]*m[15] + m[0]*m[5]*m[15],
        m[3]*m[5]*m[8] - m[1]*m[7]*m[8] - m[3]*m[4]*m[9] + m[0]*m[7]*m[9] + m[1]*m[4]*m[11] - m[0]*m[5]*m[11],
        m[6]*m[9]*m[12] - m[5]*m[10]*m[12] - m[6]*m[8]*m[13] + m[4]*m[10]*m[13] + m[5]*m[8]*m[14] - m[4]*m[9]*m[14],
        m[1]*m[10]*m[12] - m[2]*m[9]*m[12] + m[2]*m[8]*m[13] - m[0]*m[10]*m[13] - m[1]*m[8]*m[14] + m[0]*m[9]*m[14],
        m[2]*m[5]*m[12] - m[1]*m[6]*m[12] - m[2]*m[4]*m[13] + m[0]*m[6]*m[13] + m[1]*m[4]*m[14] - m[0]*m[5]*m[14],
        m[1]*m[6]*m[8] - m[2]*m[5]*m[8] + m[2]*m[4]*m[9] - m[0]*m[6]*m[9] - m[1]*m[4]*m[10] + m[0]*m[5]*m[10]
    ];
    return mat4_scale(m, 1/det);
}

function print_mat4(m){
    let str = "";
    for(let i = 0; i < m.length; i++){
        let n = m[i];
        n = n.toFixed(4);
        str += n+"\t";
        if(i%4 == 3) str += "\n";
    }
    console.log(str);
}

function translate_3d(t){
     return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        t[0], t[1], t[2], 1
    ];
}

function scale_3d(s){
    return [
        s[0], 0, 0, 0,
        0, s[1], 0, 0,
        0, 0, s[2], 0,
        0, 0, 0, 1
    ];
}

function rotate_3d(q){
    let xx = q[0]*q[0];
    let yy = q[1]*q[1];
    let zz = q[2]*q[2];
    return [
        1-2*yy-2*zz, 2*q[0]*q[1]+2*q[2]*q[3], 2*q[0]*q[2]-2*q[1]*q[3], 0,
        2*q[0]*q[1]-2*q[2]*q[3], 1-2*xx-2*zz, 2*q[1]*q[2]+2*q[0]*q[3], 0,
        2*q[0]*q[2]+2*q[1]*q[3], 2*q[1]*q[2]-2*q[0]*q[3], 1-2*xx-2*yy, 0,
        0, 0, 0, 1
    ];
}

function perspective_projection(fov, aspect_ratio, z_near, z_far){
    let f = Math.tan(fov/2);
    return [
        1/(f*aspect_ratio), 0, 0, 0,
        0, 1/f, 0, 0,
        0, 0, z_far/(z_near-z_far), -1,
        0, 0, -(z_far*z_near)/(z_far-z_near), 0
    ];
}

function lookat_matrix(from, to, world_up){
    let forward = vec3_normalize(vec3_sub(to, from));
    let right = vec3_normalize(vec3_cross(forward, world_up));
    let up = vec3_cross(right, forward);
    forward = vec3_scale(forward, -1);

    return [
        right[0], up[0], forward[0], 0,
        right[1], up[1], forward[1], 0,
        right[2], up[2], forward[2], 0,
        -vec3_dot(right, from),
        -vec3_dot(up, from),
        -vec3_dot(forward, from), 1
    ];
}

function vec2_magnitude(v){
    return Math.sqrt(v[0]*v[0] + v[1]*v[1]);
}

function vec2_normalize(v){
    let m = vec2_magnitude(v);
    if(m == 0) return [0, 0];
    return [v[0]/m, v[1]/m];
}

function vec2_add(a, b){
    return [a[0]+b[0], a[1]+b[1]];
}

function vec2_sub(a, b){
    return [a[0]-b[0], a[1]-b[1]];
}

function vec2_scale(v, s){
    return [v[0]*s, v[1]*s];
}

function vec2_hadamard(a, b){
    return [
        a[0]*b[0],
        a[1]*b[1],
    ];
}

function vec2_dot(a, b){
    return a[0]*b[0] + a[1]*b[1];
}

function vec2_cross(a, b) {
    return a[0] * b[1] - a[1] * b[0];
}

function lerp(a, b, t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    return b*t+a*(1-t);
}

function vec2_lerp(a, b, t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    return vec2_add(vec2_scale(b, t), vec2_scale(a, 1-t));
}

function vec3_cross(a, b){
    return [
        a[1]*b[2]-a[2]*b[1],
        a[2]*b[0]-a[0]*b[2],
        a[0]*b[1]-a[1]*b[0]
    ];
}

function vec3_magnitude(v){
    return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
}

function vec3_lerp(a, b, t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    return vec3_add(vec3_scale(b, t), vec3_scale(a, 1-t));
}

function vec3_dot(a, b){
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

function vec3_normalize(v){
    let m = vec3_magnitude(v);
    if(m == 0) return [0, 0, 0];
    return [
        v[0]/m,
        v[1]/m,
        v[2]/m
    ];
}

function vec3_add(a, b){
    return [
        a[0]+b[0],
        a[1]+b[1],
        a[2]+b[2],
    ];
}

function vec3_sub(a, b){
    return [
        a[0]-b[0],
        a[1]-b[1],
        a[2]-b[2],
    ];
}

function vec3_scale(v, s){
    return [
        v[0]*s,
        v[1]*s,
        v[2]*s,
    ];
}

function vec3_hadamard(a, b){
    return [
        a[0]*b[0],
        a[1]*b[1],
        a[2]*b[2],
    ];
}

function vec4_magnitude(v){
    return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2] + v[3]*v[3]);
}

function vec4_normalize(v){
    let m = vec4_magnitude(v);
    if(m == 0) return [0, 0, 0, 0];
    return [
        v[0]/m,
        v[1]/m,
        v[2]/m,
        v[2]/m
    ];
}

function vec4_add(a, b){
    return [
        a[0]+b[0],
        a[1]+b[1],
        a[2]+b[2],
        a[3]+b[3],
    ];
}

function vec4_sub(a, b){
    return [
        a[0]-b[0],
        a[1]-b[1],
        a[2]-b[2],
        a[3]-b[3],
    ];
}

function vec4_lerp(a, b, t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    return vec4_add(vec4_scale(b, t), vec4_scale(a, 1-t));
}

function vec4_scale(v, s){
    return [
        v[0]*s,
        v[1]*s,
        v[2]*s,
        v[3]*s,
    ];
}

function vec4_hadamard(a, b){
    return [
        a[0]*b[0],
        a[1]*b[1],
        a[2]*b[2],
        a[3]*b[3],
    ];
}

function quat_id(){
    return [0, 0, 0, 1];
}

function quat_rotate(q, v){
    v = v.concat([0]);
    let c = quat_conjugate(q);
    return quat_mul(quat_mul(q, v), c).slice(0, 3);
}

function axis_angle_to_quat(axis, angle){
    let s = Math.sin(angle/2);
    return [
        axis[0]*s,
        axis[1]*s,
        axis[2]*s,
        Math.cos(angle/2)
    ];
}

function euler_to_quat(e){
    let cx = Math.cos(e[0]/2);
    let sx = Math.sin(e[0]/2);
    let cy = Math.cos(e[1]/2);
    let sy = Math.sin(e[1]/2);
    let cz = Math.cos(e[2]/2);
    let sz = Math.sin(e[2]/2);
    return [
        sx*cy*cz-cx*sy*sz,
        cx*sy*cz+sx*cy*sz,
        cx*cy*sz-sx*sy*cz,
        cx*cy*cz+sx*sy*sz
    ];
}

function quat_mul(a, b){
    return [
        a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
        a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
        a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
        a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
    ];
}

function quat_magnitude(q){
    return Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
}

function quat_normalize(q){
    let m = quat_magnitude(q);
    if(m == 0) return [0, 0, 0, 0];
    return [
        q[0]/m,
        q[1]/m,
        q[2]/m,
        q[3]/m
    ];
}

function quat_conjugate(q){
    return [-q[0], -q[1], -q[2], q[3]];
}

function quat_inverse(q){
    let m = quat_magnitude(q);
    if(m == 0) return [0, 0, 0, 0];
    m *= m;
    return [-q[0]/m, -q[1]/m, -q[2]/m, q[3]/m];
}

function quat_difference(a, b){
    return quat_mul(quat_inverse(a), b);
}

function quat_exp(q){
    let v = [q[0], q[1], q[2]];
    let v_m = vec3_magnitude(v);
    let v_n = vec3_normalize(v);
    let sin_v = Math.sin(v_m);
    let exp_w = Math.exp(q[3]);
    return [
        v_n[0]*sin_v*exp_w,
        v_n[1]*sin_v*exp_w,
        v_n[2]*sin_v*exp_w,
        Math.cos(v_m)*exp_w
    ];
}

function quat_log(q){
    let v = [q[0], q[1], q[2]];
    let v_n = vec3_normalize(v);
    let m = quat_magnitude(q);
    let a = Math.acos(q[3]/m);
    return [
        v_n[0]*a,
        v_n[1]*a,
        v_n[2]*a,
        Math.log(m)
    ];
}

function quat_scale(q, s){
    return [q[0]*s, q[1]*s, q[2]*s, q[3]*s];
}

function quat_pow(q, n){
    return quat_exp(quat_scale(quat_log(q), n));
}

function quat_dot_product(q1, q2){
    return q1[0]*q2[0]+q1[1]*q2[1]+q1[2]*q2[2]+q1[3]*q2[3];
}

function bad_quat_slerp(q1, q2, t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    return quat_mul(q1, quat_pow(quat_mul(quat_inverse(q1), q2), t));
}

function quat_slerp(q1, q2, t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    if(quat_dot_product(q1, q2) < 0) q2 = quat_scale(q2, -1);
    return quat_mul(q1, quat_pow(quat_mul(quat_inverse(q1), q2), t));
}

function rad(deg){
    return deg*Math.PI/180;
}

function deg(rad){
    return rad * 180 / Math.PI;
}

function xmur3(str){
    let i, h;
    for(i = 0, h = 1779033703^str.length; i < str.length; i++){
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = h << 13 | h >>> 19;
    }
    return function(){
        h = Math.imul(h ^ h >>> 16, 2246822507);
        h = Math.imul(h ^ h >>> 13, 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }
}

function distance(a, b){
    if(a.length == 2) return vec2_magnitude(vec2_sub(a, b));
    if(a.length == 3) return vec3_magnitude(vec3_sub(a, b));
    if(a.length == 4) return vec4_magnitude(vec4_sub(a, b));
}

function clamp(v, min, max){
    return Math.min(Math.max(v, min), max);
};

function reflect_ray(incident, normal) {
    let dot = vec2_dot(incident, normal);
    return vec2_sub(incident, vec2_scale(normal, 2 * dot));
}

function refract_ray(incident, normal, eta){
    let cosi = clamp(vec2_dot(incident, normal), -1, 1);
    let k = 1 - eta * eta * (1 - cosi * cosi);
    if(k < 0) return null;
    return vec2_sub(
        vec2_scale(incident, eta),
        vec2_scale(normal, eta * cosi + Math.sqrt(k))
    );
}

function rotate_vec2(v, a){
    let c = Math.cos(a);
    let s = Math.sin(a);
    return [v[0]*c - v[1]*s, v[0]*s + v[1]*c];
}

function random_between(min, max){
    return Math.random() * (max - min) + min;
}