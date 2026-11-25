using MoneyTransfer.Core;
using Temporalio.Testing;
using Xunit;

namespace MoneyTransfer.Tests;

public class ActivityTests
{
    [Fact]
    public async Task Steps_report_their_name_and_region()
    {
        var activities = new TransferActivities("gcp-us-east4");
        var env = new ActivityEnvironment();

        var withdraw = await env.RunAsync(() => activities.Withdraw(new StepInput("t1", "alice", 1m)));
        var deposit = await env.RunAsync(() => activities.Deposit(new StepInput("t1", "bob", 1m)));

        Assert.Equal((Names.Withdraw, "gcp-us-east4"), (withdraw.Step, withdraw.Region));
        Assert.Equal((Names.Deposit, "gcp-us-east4"), (deposit.Step, deposit.Region));
    }
}
