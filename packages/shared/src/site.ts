/**
 * 站点时区：日期显示、归档按月分组、按月份筛选文章都按它算，前后端一致。
 * 否则构建机或 API 所在的服务器（通常是 UTC）和读者看到的日期会差一天。
 */
export const SITE_TIME_ZONE = "Asia/Shanghai";
