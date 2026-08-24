# Brain bundle fixtures

The transport for hekate.brain/1 bundles until an authenticated endpoint
exists. The sync reads BRAIN_BUNDLES_DIR when set (the shared folder on the
studio Mac, ~/Studio/_hekate/bundles); otherwise it reads this directory.

Only the small bundles are committed. caveman, limicon and unimpact run about
a megabyte each, so they ride the shared folder rather than the repo; the
sync reports them as missing at this transport, which is true and harmless.
The index is committed whole so the report can say what exists elsewhere.
