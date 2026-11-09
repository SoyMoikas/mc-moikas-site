#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:fog.glsl>
#include <minecraft:globals.glsl>
#include <minecraft:projection.glsl>
#include <minecraft:sample_lightmap.glsl>
#include <minecraft:terrainglobals.glsl>
#ifndef MULTIDRAW_TERRAIN
    #include <minecraft:chunksection.glsl>
#endif

layout(location = 0) in vec3 Position;
layout(location = 1) in vec4 Color;
layout(location = 2) in vec2 UV0;
layout(location = 3) in ivec2 UV2;
#ifdef MULTIDRAW_TERRAIN
layout(location = 4) in ivec3 ChunkPosition;
layout(location = 5) in float ChunkVisibility;
#endif

#ifndef OIT_ALPHA_ONLY
uniform sampler2D Sampler2;
#endif

layout(location = 0) out float sphericalVertexDistance;
layout(location = 1) out float cylindricalVertexDistance;
layout(location = 2) out vec4 vertexColor;
layout(location = 3) out vec2 texCoord0;
layout(location = 4) out float chunkVisibility;
layout(location = 5) out float grayAmount;
layout(location = 6) out float ringAmount;
layout(location = 7) out float tripAmount;

// Ocaso: how much colour dark areas lose even at full sanity
#define OCASO_BASE 0.35

void main() {
    vec3 pos = Position + (ChunkPosition - CameraBlockPos) + CameraOffset;
    gl_Position = ProjMat * ModelViewMat * vec4(pos, 1.0);

    sphericalVertexDistance = fog_spherical_distance(pos);
    cylindricalVertexDistance = fog_cylindrical_distance(pos);
    #ifndef OIT_ALPHA_ONLY
    vertexColor = Color * sample_lightmap(Sampler2, UV2);

    // --- Ocaso: colour only survives where there is light ---
    // The lightmap is the same for the whole screen, so two of its cells tell us what the server is doing:
    //  - torchRef (block light 15, sky 0) is ~1.0 normally; it drops when the server darkens the world
    //    (boss bar "darken sky" = low sanity / Blood Moon, Darkness effect = sanity below 20).
    //  - dayRef (block 0, sky 15) tells day from night.
    const vec3 LUMA = vec3(0.299, 0.587, 0.114);
    float torchRef = dot(sample_lightmap(Sampler2, ivec2(240, 0)).rgb, LUMA);
    float dayRef = clamp(dot(sample_lightmap(Sampler2, ivec2(0, 240)).rgb, LUMA), 0.0, 1.0);
    float darkSig = clamp((0.97 - torchRef) / 0.5, 0.0, 1.0);          // Darkness effect (sanity < 20)
    // Boss bar "darken sky" (sanity < 45) multiplies light by (0.7, 0.6, 0.6). The ambient cell
    // (block 0, sky 0) is a known colour per dimension, so its green/red ratio tells us exactly.
    vec3 amb = sample_lightmap(Sampler2, ivec2(0, 0)).rgb;
    float bossSig = 0.0;
    if (amb.r > 0.012) {
        float gr = amb.g / amb.r;
        float bg = amb.b / max(amb.g, 0.004);
        float base = bg > 0.95 ? 1.0 : (bg > 0.86 ? 1.127 : 0.833);    // overworld / end / nether
        bossSig = clamp((1.0 - gr / base) / 0.12, 0.0, 1.0);
    }
    // Mushroom trip = night vision (ambient becomes bright) + darkened sky at the same time.
    // Darkened overworld ambient stays under ~0.10 luma even at max Brightness, so anything brighter
    // with the boss-bar tint is night vision. Only trusted when the ambient is neutral (overworld/NV),
    // because Nether/End ambients are already bright and would false-trigger.
    float ambBg = amb.b / max(amb.g, 0.004);
    tripAmount = ambBg > 0.95 ? smoothstep(0.12, 0.22, dot(amb, LUMA)) * bossSig : 0.0;
    float ocasoSignal = max(darkSig, bossSig * 0.65) * (1.0 - tripAmount);
    float blockLight = clamp(float(UV2.x) / 240.0, 0.0, 1.0);
    float skyLight = clamp(float(UV2.y) / 240.0, 0.0, 1.0);
    // daylight only protects colour while sanity is fine; torches/lanterns always do
    float keepColour = max(pow(blockLight, 0.75), dayRef * skyLight * (1.0 - ocasoSignal));
    grayAmount = mix(OCASO_BASE, 1.0, ocasoSignal) * (1.0 - keepColour);
    ringAmount = ocasoSignal;
    #else
    vertexColor = Color;
    grayAmount = 0.0;
    ringAmount = 0.0;
    tripAmount = 0.0;
    #endif
    texCoord0 = UV0;

    const float chunkFullyVisibleRange = 16.0;
    float dist = length(pos);
    chunkVisibility = mix(1.0, ChunkVisibility, clamp((dist - chunkFullyVisibleRange) / chunkFullyVisibleRange, 0.0, 1.0));
}
