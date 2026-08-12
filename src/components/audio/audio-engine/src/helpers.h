#pragma once
#include "structures.h"

namespace Merge {

auto wrapUnit = [](float phase) { float wrapped = std::fmod(phase, 1.0f); if (wrapped < 0.0f) wrapped += 1.0f; return wrapped; };

auto jmap = [](float sourceValue, float sourceRangeMin, float sourceRangeMax, float targetRangeMin, float targetRangeMax) {
    // jassert(!approximatelyEqual(sourceRangeMax, sourceRangeMin)); // mapping from a range of zero will produce NaN!
    return targetRangeMin + ((targetRangeMax - targetRangeMin) * (sourceValue - sourceRangeMin)) / (sourceRangeMax - sourceRangeMin);
};

auto waveFromShape = [](float phase, float shape) {
    const float p = wrapUnit(phase);

    const float sine = std::sin(static_cast<float>((M_PI * 2.0) * p));
    const float tri = static_cast<float>(4.0 * std::abs(p - 0.5) - 1.0);

    if (shape < 1.0f)
        return jmap(shape, 0.0f, 1.0f, sine, tri);

    const float saw = static_cast<float>(2.0 * p - 1.0);
    if (shape < 2.0f)
        return jmap(shape, 1.0f, 2.0f, tri, saw);

    const float square = p < 0.5 ? 1.0f : -1.0f;
    if (shape < 3.0f)
        return jmap(shape, 2.0f, 3.0f, saw, square);

    const float pulse = p < 0.32 ? 1.0f : -1.0f;
        return jmap(shape, 3.0f, 4.0f, square, pulse);
};

} // namespace Merge