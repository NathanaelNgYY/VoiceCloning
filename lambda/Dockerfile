# syntax=docker/dockerfile:1.7

FROM public.ecr.aws/lambda/nodejs:22

WORKDIR ${LAMBDA_TASK_ROOT}

COPY lambda/package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY lambda/ ./

CMD ["index.handler"]
