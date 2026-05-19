#include <math.h>

typedef union{
    float q[4];
    struct{
        float x;
        float y;
        float z;
        float w;
    };
} Quaternion;

typedef union{
    float v[3];
    struct{
        float x;
        float y;
        float z;
    };
} Vector3;

typedef union{
    float m[16];
    struct{
        float m00; float m10; float m20; float m30;
        float m01; float m11; float m21; float m31;
        float m02; float m12; float m22; float m32;
        float m03; float m13; float m23; float m33;
    };
} Mat4;

float vec3_magnitude(Vector3 v);
Vector3 vec3_normalize(Vector3 v);

float quat_magnitude(Quaternion q);
Quaternion quat_normalize(Quaternion q);
Quaternion quat_id();
Quaternion quat_scale(Quaternion q, float s);
Quaternion quat_mul(Quaternion a, Quaternion b);
Quaternion euler_to_quat(Vector3 e);
Quaternion axis_angle_to_quat(Vector3 axis, float angle);
Mat4 quat_to_matrix(Quaternion q);
Quaternion quat_conjugate(Quaternion q);
Vector3 rotate_vector(Vector3 v, Quaternion q);
Quaternion quat_inverse(Quaternion q);
Quaternion quat_difference(Quaternion a, Quaternion b);
Quaternion quat_exp(Quaternion q);
Quaternion quat_log(Quaternion q);
Quaternion quat_pow(Quaternion q, float n);
float quat_dot(Quaternion q1, Quaternion q2);
Quaternion quat_slerp(Quaternion q1, Quaternion q2, float t);