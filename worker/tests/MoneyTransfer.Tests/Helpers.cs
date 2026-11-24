using System.Linq.Expressions;
using MoneyTransfer.Core;

namespace MoneyTransfer.Tests;

internal static class Helpers
{
    // Expression trees can't contain optional or named arguments, so build the input first.
    public static Expression<Func<MoneyTransferWorkflow, Task<TransferResult>>> RunWith(TransferInput input) =>
        wf => wf.RunAsync(input);
}
