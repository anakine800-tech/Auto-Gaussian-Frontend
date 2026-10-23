// Progress, filters and help share these definitions; none imply acceptance.
export const PROGRESS={
 running:{label:'在跑',detail:'本地状态为 running（含调度器排队）'},
 fetch:{label:'待取回',detail:'本地状态为 finished'},
 review:{label:'待审阅',detail:'采用结果或候选对象所用的 Attempt 已取回、facts 可读、review.md 缺失或为空'},
 reviewFallback:'尚无采用记录，按全部已取回的 Attempt 统计',
 reviewEvidence:'状态为 fetched、facts.json 是可读 JSON 对象，且 review.md 缺失或为空；已有审阅内容不代表科学验收',
 sign:{label:'待签字',detail:'里程碑记录里明确写待签或未签；空白和占位符不计入'},
 recent:'只按修改时间，不代表重要性',
} as const;
export const MILESTONES={recorded:'已签',pending:'待签',not_started:'未开始',not_applicable:'不适用',unknown:'无法识别'} as const;
