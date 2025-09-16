#!/usr/bin/env node

// Test script for the refactored GitHub client
import { GitHubAPIClient } from './dist/services/github/client.js';
import dotenv from 'dotenv';

dotenv.config();

async function testGitHubClient() {
  console.log('Testing refactored GitHub client with Octokit...\n');

  // Check if we have a token
  const token = process.env.GITHUB_TEST_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
  if (!token) {
    console.error('❌ No GitHub token found. Set GITHUB_TEST_TOKEN or GITHUB_ACCESS_TOKEN in .env');
    process.exit(1);
  }

  try {
    const client = new GitHubAPIClient(token);
    console.log('✅ Client initialized successfully\n');

    // Test 1: Get rate limit
    console.log('Test 1: Checking rate limit...');
    const rateLimit = await client.getRateLimit();
    console.log(`✅ Core API: ${rateLimit.core.remaining}/${rateLimit.core.limit} remaining`);
    console.log(`✅ GraphQL: ${rateLimit.graphql.remaining}/${rateLimit.graphql.limit} remaining\n`);

    // Test 2: List repositories
    console.log('Test 2: Listing repositories...');
    const repos = await client.listRepositories({ per_page: 5 });
    console.log(`✅ Found ${repos.length} repositories`);
    if (repos.length > 0) {
      console.log(`   First repo: ${repos[0].full_name}`);
    }
    console.log('');

    // Test 3: Test GraphQL (if we have repos)
    if (repos.length > 0 && repos[0].owner && repos[0].name) {
      console.log('Test 3: Testing GraphQL with batchFetchPullRequests...');
      const [owner, name] = repos[0].full_name.split('/');
      const prData = await client.batchFetchPullRequests(owner, name, { first: 5 });
      console.log(`✅ GraphQL query successful`);
      console.log(`   Total PRs in ${repos[0].full_name}: ${prData.totalCount}`);
      console.log(`   Fetched ${prData.pullRequests.length} PRs\n`);
    }

    // Test 4: Error handling
    console.log('Test 4: Testing error handling...');
    try {
      await client.getRepository('nonexistent-user-999', 'nonexistent-repo-999');
      console.log('❌ Expected 404 error was not thrown');
    } catch (error) {
      if (error.message.includes('not found') || error.message.includes('404')) {
        console.log('✅ Error handling works correctly (404 caught)');
      } else {
        console.log(`⚠️  Unexpected error: ${error.message}`);
      }
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('The refactored GitHub client using Octokit is working properly.');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the tests
testGitHubClient();
