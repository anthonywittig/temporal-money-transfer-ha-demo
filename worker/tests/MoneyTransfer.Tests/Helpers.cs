using System.Linq.Expressions;
using MoneyTransfer.Core;

namespace MoneyTransfer.Tests;

internal static class Helpers
{
    // Expression trees can't contain optional or named arguments, so build the input first.
    public static Expression<Func<MoneyTransferWorkflow, Task<TransferResult>>> RunWith(TransferInput input) =>
        wf => wf.RunAsync(input);

    // The workflow upserts custom search attributes, so tests need a dev server that has them registered
    // (the time-skipping test server can't register them), so the 10s post-withdraw delay runs in real time.
    public static Task<Temporalio.Testing.WorkflowEnvironment> StartEnvAsync() =>
        Temporalio.Testing.WorkflowEnvironment.StartLocalAsync(new() { SearchAttributes = TransferSearchAttributes.All });
}
