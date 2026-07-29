#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>

// Beta

namespace {

}

struct AudioNode {
    virtual ~AudioNode() = default;
};

struct MixerNode : public AudioNode {
    virtual void process(float* output, int numSamples) = 0;
};

class ModularAudioProcessor {
    public:
        std::vector<std::unique_ptr<AudioNode>> nodes;
};