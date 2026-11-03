// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev A basic ERC20 token for standalone local testing of the escrow contract.
 */
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}

/**
 * @title MockFeeOnTransferERC20
 * @dev An ERC20 token that deducts a 5% fee on every transfer to test balance delta accounting.
 */
contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public constant FEE_BPS = 500; // 5%

    constructor() ERC20("Mock Fee Token", "MFT") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * FEE_BPS) / 10000;
            uint256 netAmount = value - fee;
            super._update(from, address(0), fee); // burn fee
            super._update(from, to, netAmount);
        } else {
            super._update(from, to, value);
        }
    }
}
