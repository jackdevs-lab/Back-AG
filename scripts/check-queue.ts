import { Queue } from 'bullmq';
import IORedis from 'ioredis';

async function checkQueue(name: string) {
    const connection = new IORedis({ host: 'localhost', port: 6379 });
    const queue = new Queue(name, { connection });

    const active = await queue.getActive();
    const waiting = await queue.getWaiting();
    const delayed = await queue.getDelayed();
    const failed = await queue.getFailed();
    const completed = await queue.getCompleted();

    console.log(`Queue: ${name}`);
    console.log(`- Active: ${active.length}`);
    console.log(`- Waiting: ${waiting.length}`);
    console.log(`- Delayed: ${delayed.length}`);
    console.log(`- Failed: ${failed.length}`);
    console.log(`- Completed: ${completed.length}`);

    if (active.length > 0) {
        console.log('Active Jobs:');
        active.forEach(job => {
            console.log(`  - ID: ${job.id}, Data: ${JSON.stringify(job.data)}`);
        });
    }

    await connection.quit();
}

async function main() {
    await checkQueue('sync-queue');
    await checkQueue('analysis-queue');
}

main().catch(console.error);
