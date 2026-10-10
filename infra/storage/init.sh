#!/bin/sh
# 创建本地开发 / 测试用的存储桶，并允许匿名读取（相当于线上 R2 存储桶开启公开访问）。
# 由 docker compose 的 storage-init 服务执行；可以重复运行。
set -eu
s3() { aws --endpoint-url http://storage:9000 "$@"; }

for bucket in blog-images blog-images-test; do
  s3 s3api head-bucket --bucket "$bucket" 2>/dev/null || s3 s3api create-bucket --bucket "$bucket"
  # 只允许匿名 GetObject（读单个文件），不允许列出存储桶内容
  s3 s3api put-bucket-policy --bucket "$bucket" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{\"Effect\": \"Allow\", \"Principal\": \"*\", \"Action\": [\"s3:GetObject\"], \"Resource\": [\"arn:aws:s3:::$bucket/*\"]}]
  }"
  echo "bucket ready: $bucket"
done
