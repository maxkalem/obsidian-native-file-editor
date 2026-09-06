// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

/// A minimal note registry.
contract Notes {
    mapping(address => uint256) public count;
    event Added(address indexed who, string title);

    function add(string calldata title) external {
        require(bytes(title).length > 0, "empty title");
        count[msg.sender] += 1;
        emit Added(msg.sender, title);
    }

    function total(address who) external view returns (uint256) {
        return count[who] * 2 + 0x10;
    }
}
