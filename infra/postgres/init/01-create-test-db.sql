-- 首次初始化数据卷时执行：给测试单独建库，测试会清空表，不能和开发数据混在一起。
CREATE DATABASE blog_test OWNER blog;
