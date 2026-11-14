# TX-5DR Docker Image - Multi-Architecture Support
# 使用多阶段构建来减小最终镜像大小
# Portable, multiarch Rust toolchain for the six-mode native codec.
FROM rust:1-slim-bookworm AS native-rust-toolchain

FROM node:22-slim AS builder
COPY --from=native-rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=native-rust-toolchain /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup
ENV PATH="/usr/local/cargo/bin:${PATH}"

# 设置环境变量
ENV YARN_VERSION=4.18.1
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ARG VCS_REF=development
ARG BUILD_DATE=development
ARG BUILD_STAMP=docker
ARG TX5DR_CLUBLOG_API_KEY=

# 显示构建信息
RUN echo "Building for platform: $(uname -m)" && \
    echo "Node version: $(node --version)" && \
    echo "NPM version: $(npm --version)"

# 安装构建依赖
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-dev \
    pkg-config \
    libasound2-dev \
    libpulse-dev \
    libx11-dev \
    libxrandr-dev \
    libxinerama-dev \
    libxcursor-dev \
    libjack-jackd2-dev \
    libxi-dev \
    libxext-dev \
    libhamlib-dev \
    libhamlib4 \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 启用Corepack并安装Yarn
RUN corepack enable && \
    corepack prepare yarn@${YARN_VERSION} --activate && \
    yarn --version

# 创建应用目录
WORKDIR /app

# 复制包管理文件以利用Docker缓存
COPY package.json yarn.lock turbo.json ./

# 复制Yarn配置
COPY .yarnrc.yml ./
COPY .yarn/patches/ ./.yarn/patches/

# 复制scripts目录（postinstall脚本需要）
COPY scripts ./scripts/

# 创建packages目录结构并复制package.json文件
RUN mkdir -p packages/builtin-plugins packages/client-tools packages/contracts packages/core packages/create-tx5dr-plugin packages/electron-main packages/electron-preload packages/plugin-api packages/rigctld-server packages/server packages/shared-config packages/web
COPY packages/builtin-plugins/package.json ./packages/builtin-plugins/
COPY packages/client-tools/package.json ./packages/client-tools/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/core/package.json ./packages/core/
COPY packages/create-tx5dr-plugin/package.json ./packages/create-tx5dr-plugin/
COPY packages/electron-main/package.json ./packages/electron-main/
COPY packages/electron-preload/package.json ./packages/electron-preload/
COPY packages/plugin-api/package.json ./packages/plugin-api/
COPY packages/rigctld-server/package.json ./packages/rigctld-server/
COPY packages/server/package.json ./packages/server/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/web/package.json ./packages/web/

# 安装依赖（多架构优化）
# onnxruntime-node fetches external native binaries during install. Retry
# transient network timeouts without changing the immutable lockfile.
RUN set -eu; \
    echo "Installing dependencies for $(uname -m)..."; \
    for attempt in 1 2 3; do \
      if YARN_HTTP_TIMEOUT=300000 yarn install --immutable; then exit 0; fi; \
      if [ "$attempt" = 3 ]; then echo "Yarn immutable install failed 3 times" >&2; exit 1; fi; \
      sleep $((attempt * 15)); \
    done

# 复制源代码
COPY . .

# 生成ICO文件（如果需要）
RUN node scripts/generate-ico.js || true

# 生成服务端构建元数据
RUN node scripts/check-version-consistency.mjs && \
    node scripts/prepare-server-build-info.mjs \
    --channel nightly \
    --commit "${VCS_REF}" \
    --build-timestamp "${BUILD_DATE}" \
    --build-stamp "${BUILD_STAMP}" \
    --distribution docker

# Compile for the container's real CPU architecture: neither x64 nor arm64
# may accidentally ship a host-architecture .node binary.
RUN cargo build --manifest-path packages/mfsk-native/Cargo.toml --release \
    && cp packages/mfsk-native/target/release/libtx5dr_mfsk_native.so packages/mfsk-native/mfsk-native.node \
    && node packages/mfsk-native/smoke.cjs

# 构建应用
RUN echo "Building application for $(uname -m)..." && \
    TX5DR_CLUBLOG_API_KEY="$TX5DR_CLUBLOG_API_KEY" yarn build

# A Docker production image must not retain the compiled comparison modules
# emitted by the common TypeScript build. Only the staging builder is pruned.
RUN node scripts/prune-wsjtx-comparison.mjs /app

# Rust replaces the old production codec; the legacy package is only a
# development comparison dependency and must not reach the runtime image.
# 清理不必要的文件但保留生产依赖
RUN rm -rf node_modules/wsjtx-lib && \
    yarn cache clean && \
    rm -rf .yarn/cache .yarn/unplugged && \
    rm -rf packages/*/src packages/*/test && \
    rm -rf scripts/generate-ico.js && \
    rm -rf node_modules/.cache \
    packages/*/node_modules/.cache

# 运行时使用 Debian 13，确保本机库支持 GLIBCXX_3.4.32；避免在 Bookworm 中混装 libc6。
FROM node:22-trixie-slim

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# 运行共享安装脚本（--docker 模式）修复 GLIBCXX 等兼容性问题
COPY linux/lib/ /tmp/tx5dr-linux/lib/
COPY linux/install.sh /tmp/tx5dr-linux/install.sh
RUN bash /tmp/tx5dr-linux/install.sh --docker

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    libasound2t64 \
    libglib2.0-0t64 \
    libpulse0 \
    libxcomposite1 \
    libxdamage1 \
    libx11-6 \
    libxfixes3 \
    libxrandr2 \
    libxinerama1 \
    libxcursor1 \
    libdrm2 \
    libgbm1 \
    libjack-jackd2-0 \
    libxi6 \
    libxext6 \
    libhamlib4t64 \
    udev \
    nginx \
    supervisor \
    gosu \
    openssl \
    unzip \
    iproute2 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && apt-get autoremove -y

# 创建应用目录
WORKDIR /app

# 从构建阶段复制构建产物和必要文件
COPY --from=builder /app/packages ./packages/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/resources/models ./resources/models/
COPY --from=builder /app/resources/licenses ./resources/licenses/
COPY --from=builder /app/resources/README.txt ./resources/README.txt
RUN test -f resources/models/deepcw/model.onnx \
    && test -f resources/models/deepcw/model.onnx.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/turbo.json ./turbo.json

# Package-level dependency scan before any image can be accepted/published.
COPY scripts/audit-wsjtx-production.mjs /tmp/tx5dr-audit-wsjtx.mjs
RUN node /tmp/tx5dr-audit-wsjtx.mjs /app && rm /tmp/tx5dr-audit-wsjtx.mjs

RUN rm -rf /tmp/tx5dr-linux/
RUN node -e "const a=require('audify'); const e=new a.OpusEncoder(48000,1,a.OpusApplication.OPUS_APPLICATION_RESTRICTED_LOWDELAY); const d=new a.OpusDecoder(48000,1); const p=e.encode(Buffer.alloc(960*2),960); d.decode(p,960); console.log('audify Opus runtime ok');" \
    && node -e "const n=require('./packages/mfsk-native/mfsk-native.node'); for(const m of ['FT8','FT4','WSPR','Q65-60B','MSK144','JTTY'])if(!n.supportedModes().includes(m))throw new Error('MFSK mode missing: '+m); console.log('native MFSK runtime ok',n.codecVersion())" \
    && node -e "if(require('node:fs').existsSync('node_modules/wsjtx-lib'))throw Error('legacy wsjtx-lib in production image')" \
    && node scripts/smoke-image-radio.cjs

# Nginx configuration: shared template + Docker-specific wrapper
COPY docker/nginx-wrapper.conf /etc/nginx/nginx.conf
COPY linux/nginx-site.conf /tmp/nginx-site.conf.template
RUN sed -e 's|%%LISTEN_PORT%%|80|g' \
        -e 's|%%WEB_ROOT%%|/app/packages/web/dist|g' \
        -e 's|%%API_HOST%%|127.0.0.1:4000|g' \
        /tmp/nginx-site.conf.template > /etc/nginx/conf.d/tx5dr.conf \
    && rm /tmp/nginx-site.conf.template

# Supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 复制entrypoint脚本
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 创建数据目录
RUN mkdir -p /app/data/config /app/data/plugins /app/data/logs /app/data/cache /app/data/realtime

# 设置权限
RUN chown -R www-data:www-data /app/data && \
    chmod -R u+rwX,go+rX,go-w /app/data

# 暴露端口
EXPOSE 80
EXPOSE 443
# rigctld-compatible TCP bridge (enable via Web UI → System Settings → Rigctld Bridge)
EXPOSE 4532
# rtc-data-audio WebRTC DataChannel UDP
EXPOSE 50110/udp

# 设置entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# 默认启动supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"] 
