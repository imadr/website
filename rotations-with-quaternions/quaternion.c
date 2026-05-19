#include "quaternion.h"

float vec3_magnitude(Vector3 v){
    return sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
}

Vector3 vec3_normalize(Vector3 v){
    float m = vec3_magnitude(v);
    if(m == 0) return (Vector3){0, 0, 0};
    return (Vector3){
        v.x/m,
        v.y/m,
        v.z/m
    };
}

float quat_magnitude(Quaternion q){
    return sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w);
}

Quaternion quat_normalize(Quaternion q){
    float m = quat_magnitude(q);
    if(m == 0) return (Quaternion){0, 0, 0, 0};
    return (Quaternion){
        q.x/m,
        q.y/m,
        q.z/m,
        q.w/m
    };
}

Quaternion quat_id(){
    return (Quaternion){0, 0, 0, 1};
}

Quaternion quat_scale(Quaternion q, float s){
    return (Quaternion){q.x*s, q.y*s, q.z*s, q.w*s};
}

Quaternion quat_mul(Quaternion a, Quaternion b){
    return (Quaternion){
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    };
}

Quaternion euler_to_quat(Vector3 e){
    float cx = cos(e.x/2);
    float sx = sin(e.x/2);
    float cy = cos(e.y/2);
    float sy = sin(e.y/2);
    float cz = cos(e.z/2);
    float sz = sin(e.z/2);
    return (Quaternion){
        sx*cy*cz - cx*sy*sz,
        cx*sy*cz + sx*cy*sz,
        cx*cy*sz - sx*sy*cz,
        cx*cy*cz + sx*sy*sz
    };
}

Quaternion axis_angle_to_quat(Vector3 axis, float angle){
    float s = sin(angle/2);
    return (Quaternion){
        axis.x*s,
        axis.y*s,
        axis.z*s,
        cos(angle/2)
    };
}

Mat4 quat_to_matrix(Quaternion q){
    float xx = q.x*q.x;
    float yy = q.y*q.y;
    float zz = q.z*q.z;
    return (Mat4){
        1-2*yy-2*zz, 2*q.x*q.y+2*q.z*q.w, 2*q.x*q.z-2*q.y*q.w, 0,
        2*q.x*q.y-2*q.z*q.w, 1-2*xx-2*zz, 2*q.y*q.z+2*q.x*q.w, 0,
        2*q.x*q.z+2*q.y*q.w, 2*q.y*q.z-2*q.x*q.w, 1-2*xx-2*yy, 0,
        0, 0, 0, 1
    };
}

Quaternion quat_conjugate(Quaternion q){
    return (Quaternion){-q.x, -q.y, -q.z, q.w};
}

Vector3 rotate_vector(Vector3 v, Quaternion q){
    Quaternion v_ = (Quaternion){v.x, v.y, v.z, 0};
    v_ = quat_mul(quat_mul(q, v_), quat_conjugate(q));
    return (Vector3){v_.x, v_.y, v_.z};
}

Quaternion quat_inverse(Quaternion q){
    float m = quat_magnitude(q);
    if(m == 0) return (Quaternion){0, 0, 0, 0};
    m *= m;
    return (Quaternion){-q.x/m, -q.y/m, -q.z/m, q.w/m};
}

Quaternion quat_difference(Quaternion a, Quaternion b){
    return quat_mul(quat_inverse(a), b);
}

Quaternion quat_exp(Quaternion q){
    Vector3 v = (Vector3){q.x, q.y, q.z};
    float v_m = vec3_magnitude(v);
    Vector3 v_n = vec3_normalize(v);
    float sin_v = sin(v_m);
    float exp_w = exp(q.w);
    return (Quaternion){
        v_n.x*sin_v*exp_w,
        v_n.y*sin_v*exp_w,
        v_n.z*sin_v*exp_w,
        cos(v_m)*exp_w
    };
}

Quaternion quat_log(Quaternion q){
    Vector3 v = (Vector3){q.x, q.y, q.z};
    Vector3 v_n = vec3_normalize(v);
    float m = quat_magnitude(q);
    float a = acos(q.w/m);
    return (Quaternion){
        v_n.x*a,
        v_n.y*a,
        v_n.z*a,
        log(m)
    };
}

Quaternion quat_pow(Quaternion q, float n){
    return quat_exp(quat_scale(quat_log(q), n));
}

float quat_dot(Quaternion q1, Quaternion q2){
    return q1.x*q2.x + q1.y*q2.y + q1.z*q2.z + q1.w*q2.w;
}

Quaternion quat_slerp(Quaternion q1, Quaternion q2, float t){
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    if(quat_dot(q1, q2) < 0) q2 = quat_scale(q2, -1);
    return quat_mul(q1, quat_pow(quat_mul(quat_inverse(q1), q2), t));
}